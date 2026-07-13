// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";
import race from "race-as-promised";

import Log from "@foxglove/log";
import {
  isGreaterThan,
  Time,
  fromMillis,
  fromNanoSec,
  subtract,
  toNanoSec,
} from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import type { TopicStats } from "@foxglove/studio-base/players/types";
import { OptionalMessageDefinition, RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import type {
  PersistentMessageCache,
  PersistentMessageCacheAppendOptions,
} from "./PersistentMessageCache";

const log = Log.getLogger(__filename);

export const LEGACY_MESSAGE_CACHE_DB_NAME = "studio-realtime-cache";
export const REALTIME_MESSAGE_CACHE_DB_NAME = "studio-realtime-history-v1";
export const PLAYBACK_MESSAGE_CACHE_DB_NAME = "studio-playback-spill-v1";
const DB_VERSION = 1;
const STORE = "messages";
const DATATYPES_STORE = "datatypes";
const SESSIONS_STORE = "sessions";
const TOPICS_STORE = "topics";
const LOADED_RANGES_STORE = "loadedRanges";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const PLAYBACK_SPILL_TTL_MS = 24 * 60 * 60 * 1000;
const PLAYBACK_SPILL_PRESSURE_STALE_MS = 5 * 60 * 1000;
const DEFAULT_OPEN_TIMEOUT_MS = 5000;
const GIBIBYTE = 1024 * 1024 * 1024;
const MEBIBYTE = 1024 * 1024;
const PLAYBACK_BUDGET_RATIO = 0.1;
const PLAYBACK_BUDGET_MAX_BYTES = 8 * GIBIBYTE;
const PLAYBACK_BUDGET_FALLBACK_BYTES = 2 * GIBIBYTE;
const PLAYBACK_BUDGET_MIN_BYTES = 256 * MEBIBYTE;
const REALTIME_BUDGET_RATIO = 0.05;
const REALTIME_BUDGET_MAX_BYTES = 2 * GIBIBYTE;
const REALTIME_BUDGET_FALLBACK_BYTES = 512 * MEBIBYTE;
const STORAGE_PRESSURE_HIGH_WATERMARK = 0.8;
const STORAGE_PRESSURE_LOW_WATERMARK = 0.7;
const STORAGE_PRESSURE_LATCH_KEY = "studio-message-cache-storage-pressure-v1";
const GLOBAL_BUDGET_LOW_WATERMARK = 0.8;
const GLOBAL_BUDGET_CHECK_INTERVAL_MS = 30 * 1000;
const GLOBAL_BUDGET_CHECK_BYTES = 64 * MEBIBYTE;
const PERIODIC_STORAGE_ESTIMATE_TIMEOUT_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAINTENANCE_TIMEOUT_MS = 30_000;
const MAX_SHUTDOWN_STATUS_RESERVE_MS = 500;
const DEFAULT_APPEND_BATCH_MAX_BYTES = 64 * MEBIBYTE;
const DEFAULT_APPEND_QUEUE_MAX_BYTES = 128 * MEBIBYTE;
const CLEANUP_BATCH_MAX_MESSAGES = 10_000;
const CLEANUP_BATCH_MAX_BYTES = 64 * MEBIBYTE;
const MESSAGE_READ_PAGE_MAX_SCANNED_RECORDS = 10_000;

class StorageEstimateTimeoutError extends Error {}
class ShutdownTimeoutError extends Error {}
class MaintenanceTimeoutError extends Error {}

export type CacheSessionKind = "realtime-viz" | "playback-spill";

export type MessageCacheMetricData = Readonly<
  Record<string, string | number | boolean | undefined>
>;
export type MessageCacheMetricSink = (event: string, data: MessageCacheMetricData) => void;

export type CacheSessionMetadata = {
  sessionId: string;
  kind: CacheSessionKind;
  createdAt: number;
  lastActiveAt: number;
  sourceId?: string;
  topicFingerprint?: string;
  retentionWindowMs?: number;
  maxBytes?: number;
  status?: "active" | "closed" | "abandoned" | "pending-delete";
  /** Ownership token preventing a stale cleaner from deleting a recreated same-id session. */
  cleanupToken?: string;
  /** Live connection leases; stale entries are reclaimed with the session TTL after a crash. */
  owners?: readonly string[];
  /** Persisted generation used to reject coverage written after another connection pruned data. */
  contentRevision?: number;
  nextSeq: number;
  approximateSizeBytes: number;
  messageCount?: number;
};

export type TopicMetadata = TopicWithDecodingInfo & {
  topicStats?: TopicStats;
};

export type LoadedRange = {
  id: string;
  sessionId: string;
  topicFingerprint: string;
  start: Time;
  end: Time;
  updatedAt: number;
  /** Revision of the session contents covered by this range. Missing values belong to revision 0. */
  contentRevision?: number;
};

export type MessagePageCursor = {
  receiveTime: Time;
  seq: number;
};

export type MessagePage = {
  messages: readonly MessageEvent[];
  /** Cursor after the last record inspected. Present whenever `complete` is false. */
  nextCursor?: MessagePageCursor;
  complete: boolean;
};

type StoredMessageEvent = Omit<MessageEvent, "originalMessageEvent"> & {
  sessionId: string;
  seq: number;
  estimatedCacheBytes: number;
};

type QueuedMessage = {
  event: MessageEvent;
  estimatedCacheBytes: number;
};

type ActiveTransaction = {
  readonly done: Promise<unknown>;
  abort(): void;
};

type CleanupBatchResult = { deletedAny: boolean; stillOwner: boolean };

interface MessagesDB extends IDB.DBSchema {
  [STORE]: {
    key: [sessionId: string, sec: number, nsec: number, seq: number];
    value: StoredMessageEvent;
    indexes: {
      bySessionTime: [sessionId: string, sec: number, nsec: number];
      bySessionTopicTime: [sessionId: string, topic: string, sec: number, nsec: number];
      bySession: string;
    };
  };
  [DATATYPES_STORE]: {
    key: string;
    value: {
      sessionId: string;
      datatypes: Record<string, OptionalMessageDefinition>;
      timestamp: number;
    };
  };
  [SESSIONS_STORE]: {
    key: string;
    value: CacheSessionMetadata;
    indexes: {
      byKind: CacheSessionKind;
      byKindLastActive: [kind: CacheSessionKind, lastActiveAt: number];
    };
  };
  [TOPICS_STORE]: {
    key: [sessionId: string, name: string];
    value: {
      sessionId: string;
      name: string;
      schemaName: string | undefined;
      messageEncoding?: string;
      schemaEncoding?: string;
      schemaData?: Uint8Array;
      topicStats?: TopicStats;
      updatedAt: number;
    };
    indexes: {
      bySession: string;
    };
  };
  [LOADED_RANGES_STORE]: {
    key: string;
    value: LoadedRange;
    indexes: {
      bySession: string;
      bySessionFingerprintStart: [
        sessionId: string,
        topicFingerprint: string,
        sec: number,
        nsec: number,
      ];
    };
  };
}

function sanitizeEvent(
  sessionId: string,
  seq: number,
  event: MessageEvent,
  estimatedCacheBytes: number,
): StoredMessageEvent {
  const { originalMessageEvent: _drop, ...rest } = event;
  return { ...rest, sessionId, seq, estimatedCacheBytes };
}

function restoreEvent(event: StoredMessageEvent): MessageEvent {
  const {
    sessionId: _sessionId,
    seq: _seq,
    estimatedCacheBytes: _estimatedCacheBytes,
    ...rest
  } = event;
  return rest;
}

function validatedSize(size: number, fieldName: string): number {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`${fieldName} must be a finite, non-negative number`);
  }
  return size;
}

function normalizedStoredSize(size: unknown): number {
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

function normalizedContentRevision(revision: unknown): number {
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : 0;
}

function createConnectionOwnerId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable?: boolean },
    callback: (lock: object | undefined) => T | Promise<T>,
  ): Promise<T>;
};

function getBrowserLockManager(): BrowserLockManager | undefined {
  const runtimeNavigator = (globalThis as { navigator?: Navigator }).navigator as
    | (Navigator & { locks?: BrowserLockManager })
    | undefined;
  return runtimeNavigator?.locks;
}

let inMemoryStoragePressureToken: string | undefined;
let storagePressureHighEpoch = 0;
let storagePressureRecoveryGeneration = 0;

function readStoragePressureToken(): string | undefined {
  try {
    const token = localStorage.getItem(STORAGE_PRESSURE_LATCH_KEY) ?? undefined;
    inMemoryStoragePressureToken = token;
    return token;
  } catch {
    return inMemoryStoragePressureToken;
  }
}

function isStoragePressureLatched(): boolean {
  return readStoragePressureToken() != undefined;
}

function writeStoragePressureLatch(): void {
  const token = `pressure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  inMemoryStoragePressureToken = token;
  try {
    localStorage.setItem(STORAGE_PRESSURE_LATCH_KEY, token);
  } catch {
    // Storage pressure handling must remain fail-open when localStorage is unavailable.
  }
}

async function latchStoragePressure(): Promise<void> {
  const locks = getBrowserLockManager();
  if (locks == undefined) {
    writeStoragePressureLatch();
    return;
  }
  try {
    await locks.request("studio-message-cache-storage-pressure-v1", { mode: "exclusive" }, () => {
      writeStoragePressureLatch();
    });
  } catch {
    // A confirmed high-pressure observation must fail closed even when Web Locks is denied.
    writeStoragePressureLatch();
  }
}

function clearStoragePressureLatchIfUnchangedWithoutLock(
  expectedToken: string | undefined,
): boolean {
  if (readStoragePressureToken() !== expectedToken) {
    return false;
  }
  inMemoryStoragePressureToken = undefined;
  try {
    localStorage.removeItem(STORAGE_PRESSURE_LATCH_KEY);
  } catch {
    // Storage pressure handling must remain fail-open when localStorage is unavailable.
  }
  return true;
}

async function clearStoragePressureLatchIfUnchanged(
  expectedToken: string | undefined,
): Promise<boolean> {
  const locks = getBrowserLockManager();
  if (locks == undefined) {
    return clearStoragePressureLatchIfUnchangedWithoutLock(expectedToken);
  }
  try {
    return await locks.request(
      "studio-message-cache-storage-pressure-v1",
      { mode: "exclusive", ifAvailable: true },
      (lock) =>
        lock == undefined ? false : clearStoragePressureLatchIfUnchangedWithoutLock(expectedToken),
    );
  } catch {
    // Recovery is optional; retain the latch if cross-context arbitration is unavailable.
    return false;
  }
}

const inProcessMaintenanceTails = new Map<string, Promise<void>>();

class CacheMaintenanceOperationError extends Error {
  public constructor(public readonly originalError: unknown) {
    super("Cache maintenance operation failed");
  }
}

async function serializeMaintenanceInProcess<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = inProcessMaintenanceTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  inProcessMaintenanceTails.set(key, tail);
  try {
    return await current;
  } finally {
    if (inProcessMaintenanceTails.get(key) === tail) {
      inProcessMaintenanceTails.delete(key);
    }
  }
}

async function runWithCacheMaintenanceLock<T>(
  dbName: string,
  kind: CacheSessionKind,
  operation: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const key = `${dbName}:${kind}`;
  return await serializeMaintenanceInProcess(key, async () => {
    const locks = getBrowserLockManager();
    if (locks == undefined) {
      return { acquired: true, value: await operation() };
    }
    try {
      return await locks.request(
        `studio-message-cache-maintenance:${key}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock == undefined) {
            return { acquired: false as const };
          }
          try {
            return { acquired: true as const, value: await operation() };
          } catch (error) {
            throw new CacheMaintenanceOperationError(error);
          }
        },
      );
    } catch (error) {
      if (error instanceof CacheMaintenanceOperationError) {
        throw error.originalError;
      }
      // Preserve best-effort maintenance on browsers that expose but deny Web Locks. Per-session
      // cleanup tokens and atomic metadata updates remain the fallback arbitration mechanism.
      return { acquired: true, value: await operation() };
    }
  });
}

type IdleSchedulingGlobal = {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function getIdleSchedulingGlobal(): IdleSchedulingGlobal {
  return globalThis as IdleSchedulingGlobal;
}

function storedEventSize(event: StoredMessageEvent): number {
  const estimated = event.estimatedCacheBytes;
  if (Number.isFinite(estimated) && estimated >= 0) {
    return estimated;
  }
  return Number.isFinite(event.sizeInBytes) && event.sizeInBytes >= 0 ? event.sizeInBytes : 0;
}

function databaseNameForKind(kind: CacheSessionKind): string {
  return kind === "playback-spill"
    ? PLAYBACK_MESSAGE_CACHE_DB_NAME
    : REALTIME_MESSAGE_CACHE_DB_NAME;
}

function isLoadedRangeCovering(ranges: readonly LoadedRange[], start: Time, end: Time): boolean {
  if (compareTime(start, end) > 0) {
    return true;
  }

  let coveredStart = toNanoSec(start);
  const targetEnd = toNanoSec(end);

  for (const range of ranges) {
    const rangeStart = toNanoSec(range.start);
    const rangeEnd = toNanoSec(range.end);
    if (rangeEnd < coveredStart) {
      continue;
    }
    if (rangeStart > coveredStart) {
      return false;
    }
    if (rangeEnd >= targetEnd) {
      return true;
    }
    coveredStart = rangeEnd + 1n;
  }

  return false;
}

function compareTime(a: Time, b: Time): number {
  return a.sec === b.sec ? a.nsec - b.nsec : a.sec - b.sec;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("Unknown error");
}

interface IndexedDbMessageStoreOptions {
  /** Retention window in milliseconds (default: 30 seconds) */
  retentionWindowMs?: number;
  /** Custom session ID (default: auto-generated) */
  sessionId?: string;
  /** Optional caller cap applied in addition to the adaptive origin budget. */
  maxCacheSize?: number;
  /** Session kind to isolate realtime history from future playback spill cache. */
  kind?: CacheSessionKind;
  sourceId?: string;
  topicFingerprint?: string;
  /** Maximum queued messages before the cache fails closed to avoid incomplete coverage. */
  maxQueuedMessages?: number;
  /** Maximum messages written per IndexedDB transaction. */
  appendBatchMaxSize?: number;
  /** Maximum estimated bytes written per IndexedDB transaction. */
  appendBatchMaxBytes?: number;
  /** Maximum estimated bytes waiting for an IndexedDB transaction. */
  maxQueuedBytes?: number;
  /** Timeout for blocked IndexedDB opens so realtime viz can degrade instead of hanging. */
  openTimeoutMs?: number;
  /** Deadline for sealing in-flight work before a cache connection is force-closed. */
  shutdownTimeoutMs?: number;
  /** Absolute deadline for a maintenance pass, including every cleanup and budget transaction. */
  maintenanceTimeoutMs?: number;
  /** Internal mode used by the idle janitor; does not create a cache session. */
  maintenanceOnly?: boolean;
  /** Optional privacy-safe telemetry sink supplied by the owning player. */
  metricSink?: MessageCacheMetricSink;
}

function createMessageStores(db: IDB.IDBPDatabase<MessagesDB>): void {
  const store = db.createObjectStore(STORE, {
    keyPath: ["sessionId", "receiveTime.sec", "receiveTime.nsec", "seq"],
  });
  store.createIndex("bySessionTime", ["sessionId", "receiveTime.sec", "receiveTime.nsec"]);
  store.createIndex("bySessionTopicTime", [
    "sessionId",
    "topic",
    "receiveTime.sec",
    "receiveTime.nsec",
  ]);
  store.createIndex("bySession", "sessionId");
}

function createDatatypesStore(db: IDB.IDBPDatabase<MessagesDB>): void {
  db.createObjectStore(DATATYPES_STORE, { keyPath: "sessionId" });
}

function createSessionsStore(db: IDB.IDBPDatabase<MessagesDB>): void {
  const store = db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
  store.createIndex("byKind", "kind");
  store.createIndex("byKindLastActive", ["kind", "lastActiveAt"]);
}

function createTopicsStore(db: IDB.IDBPDatabase<MessagesDB>): void {
  const store = db.createObjectStore(TOPICS_STORE, { keyPath: ["sessionId", "name"] });
  store.createIndex("bySession", "sessionId");
}

function createLoadedRangesStore(db: IDB.IDBPDatabase<MessagesDB>): void {
  const store = db.createObjectStore(LOADED_RANGES_STORE, { keyPath: "id" });
  store.createIndex("bySession", "sessionId");
  store.createIndex("bySessionFingerprintStart", [
    "sessionId",
    "topicFingerprint",
    "start.sec",
    "start.nsec",
  ]);
}

function ensureBaseStores(db: IDB.IDBPDatabase<MessagesDB>): void {
  if (!db.objectStoreNames.contains(STORE)) {
    createMessageStores(db);
  }
  if (!db.objectStoreNames.contains(DATATYPES_STORE)) {
    createDatatypesStore(db);
  }
  if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
    createSessionsStore(db);
  }
}

export class IndexedDbMessageStore implements PersistentMessageCache {
  #dbPromise: Promise<IDB.IDBPDatabase<MessagesDB>>;
  #dbName: string;
  #retentionWindowMs: number;
  /** Per-session cap, optionally narrowed by the caller. */
  #maxCacheSize: number;
  /** Adaptive total budget shared by every session of this physical database/kind. */
  #globalBudgetBytes: number;
  #configuredMaxCacheSize?: number;
  #kind: CacheSessionKind;
  #sourceId?: string;
  #topicFingerprint?: string;
  #maintenanceOnly: boolean;
  #metricSink: MessageCacheMetricSink | undefined;
  #initializationDeadlineAt: number;
  #currentSessionId: string;
  #ownerId = createConnectionOwnerId();
  #initPromise: Promise<void>;
  #closing = false;
  #closed = false;
  #unavailable = false;
  #writesDisabled = false;
  #originUsageBytes: number | undefined;
  #originQuotaBytes: number | undefined;
  #writeFailure: Error | undefined;
  #contentRevision = 0;
  #lastPruneTime?: number;
  #lastGlobalBudgetCheck?: number;
  #bytesSinceGlobalBudgetCheck = 0;
  #pruneIntervalMs: number = 1 * 1000;
  #messageCount = 0;
  #approximateSizeBytes = 0;
  #appendQueue: QueuedMessage[] = [];
  #appendQueueEstimatedBytes = 0;
  #appendFlushTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  #appendFlushInFlight: Promise<void> | undefined = undefined;
  #activeAppendTransaction: { abort(): void } | undefined;
  #activeTransactions = new Set<ActiveTransaction>();
  #resourceClosePromise: Promise<void> | undefined;
  #backgroundMaintenanceCancel: (() => void) | undefined;
  #backgroundMaintenancePromise: Promise<boolean> | undefined;
  #budgetEnforcementPromise: Promise<void> | undefined;
  #storageEstimateGeneration = 0;

  #appendBatchMaxSize = 1000;
  #appendBatchMaxBytes: number;
  #appendBatchMaxDelayMs = 200;
  #maxQueuedMessages: number;
  #maxQueuedBytes: number;
  #shutdownTimeoutMs: number;
  #maintenanceTimeoutMs: number;
  #shutdownDeadlineAt: number | undefined;

  public constructor(options: IndexedDbMessageStoreOptions = {}) {
    const {
      retentionWindowMs = 30 * 1000,
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      maxCacheSize,
      kind = "realtime-viz",
      sourceId,
      topicFingerprint,
      maxQueuedMessages = 50_000,
      appendBatchMaxSize = 1000,
      appendBatchMaxBytes = DEFAULT_APPEND_BATCH_MAX_BYTES,
      maxQueuedBytes = DEFAULT_APPEND_QUEUE_MAX_BYTES,
      openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
      shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
      maintenanceTimeoutMs = DEFAULT_MAINTENANCE_TIMEOUT_MS,
      maintenanceOnly = false,
      metricSink,
    } = options;

    this.#retentionWindowMs = retentionWindowMs;
    this.#kind = kind;
    this.#dbName = databaseNameForKind(kind);
    this.#configuredMaxCacheSize =
      maxCacheSize == undefined ? undefined : validatedSize(maxCacheSize, "maxCacheSize");
    this.#globalBudgetBytes =
      kind === "playback-spill" ? PLAYBACK_BUDGET_FALLBACK_BYTES : REALTIME_BUDGET_FALLBACK_BYTES;
    this.#maxCacheSize = Math.min(
      this.#configuredMaxCacheSize ?? Number.POSITIVE_INFINITY,
      this.#globalBudgetBytes,
    );
    this.#sourceId = sourceId;
    this.#topicFingerprint = topicFingerprint;
    this.#maintenanceOnly = maintenanceOnly;
    this.#metricSink = metricSink;
    this.#currentSessionId = sessionId;
    if (!Number.isSafeInteger(maxQueuedMessages) || maxQueuedMessages <= 0) {
      throw new Error("maxQueuedMessages must be a positive safe integer");
    }
    if (!Number.isSafeInteger(appendBatchMaxSize) || appendBatchMaxSize <= 0) {
      throw new Error("appendBatchMaxSize must be a positive safe integer");
    }
    validatedSize(appendBatchMaxBytes, "appendBatchMaxBytes");
    if (appendBatchMaxBytes <= 0) {
      throw new Error("appendBatchMaxBytes must be positive");
    }
    validatedSize(maxQueuedBytes, "maxQueuedBytes");
    if (maxQueuedBytes < appendBatchMaxBytes) {
      throw new Error("maxQueuedBytes must be at least appendBatchMaxBytes");
    }
    if (!Number.isFinite(openTimeoutMs) || openTimeoutMs <= 0) {
      throw new Error("openTimeoutMs must be a finite, positive number");
    }
    if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
      throw new Error("shutdownTimeoutMs must be a finite, positive number");
    }
    if (!Number.isFinite(maintenanceTimeoutMs) || maintenanceTimeoutMs <= 0) {
      throw new Error("maintenanceTimeoutMs must be a finite, positive number");
    }
    this.#maxQueuedMessages = maxQueuedMessages;
    this.#appendBatchMaxSize = appendBatchMaxSize;
    this.#appendBatchMaxBytes = appendBatchMaxBytes;
    this.#maxQueuedBytes = maxQueuedBytes;
    this.#shutdownTimeoutMs = shutdownTimeoutMs;
    this.#maintenanceTimeoutMs = maintenanceTimeoutMs;

    const openStartedAt = performance.now();
    this.#initializationDeadlineAt = openStartedAt + openTimeoutMs;
    let openStage: "opening" | "blocked" | "upgrading" = "opening";
    const rawDbPromise = IDB.openDB<MessagesDB>(this.#dbName, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, transaction) => {
        openStage = "upgrading";
        this.#reportMetric("upgrade", { status: "started", oldVersion });
        log.info("IndexedDbMessageStore schema upgrade started", {
          dbName: this.#dbName,
          oldVersion,
        });
        ensureBaseStores(db);
        if (!db.objectStoreNames.contains(TOPICS_STORE)) {
          createTopicsStore(db);
        }
        if (!db.objectStoreNames.contains(LOADED_RANGES_STORE)) {
          createLoadedRangesStore(db);
        }
        void transaction.done.then(
          () => {
            this.#reportMetric("upgrade", {
              status: "succeeded",
              oldVersion,
              durationMs: performance.now() - openStartedAt,
            });
            log.info("IndexedDbMessageStore schema upgrade complete", {
              dbName: this.#dbName,
              oldVersion,
              durationMs: performance.now() - openStartedAt,
            });
          },
          (error: unknown) => {
            this.#reportMetric("upgrade", {
              status: "failed",
              oldVersion,
              durationMs: performance.now() - openStartedAt,
            });
            log.error("IndexedDbMessageStore schema upgrade failed", {
              dbName: this.#dbName,
              oldVersion,
              error,
            });
          },
        );
      },
      blocked: (currentVersion, blockedVersion) => {
        openStage = "blocked";
        this.#reportMetric("blocked", {
          currentVersion,
          blockedVersion: blockedVersion ?? -1,
          durationMs: performance.now() - openStartedAt,
        });
        log.warn(
          "IndexedDbMessageStore initialization blocked by another open database connection",
          {
            dbName: this.#dbName,
            currentVersion,
            blockedVersion,
            durationMs: performance.now() - openStartedAt,
          },
        );
      },
      blocking: (currentVersion, blockedVersion, event) => {
        this.#unavailable = true;
        this.#abortActiveTransactions();
        this.#reportMetric("connection", {
          status: "versionchange",
          currentVersion,
          blockedVersion: blockedVersion ?? -1,
        });
        log.warn("IndexedDbMessageStore is closing for a newer database version", {
          dbName: this.#dbName,
          currentVersion,
          blockedVersion,
        });
        const connection = event.target;
        if (connection != undefined && "close" in connection) {
          (connection as IDBDatabase).close();
        }
      },
      terminated: () => {
        this.#unavailable = true;
        this.#abortActiveTransactions();
        this.#reportMetric("connection", { status: "terminated" });
        log.warn("IndexedDbMessageStore connection terminated unexpectedly", {
          dbName: this.#dbName,
        });
      },
    });
    this.#dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        this.#reportMetric("open", {
          status: "timeout",
          stage: openStage,
          durationMs: performance.now() - openStartedAt,
        });
        log.warn("IndexedDbMessageStore availability deadline exceeded", {
          dbName: this.#dbName,
          stage: openStage,
          durationMs: performance.now() - openStartedAt,
        });
        reject(new Error("Timed out opening IndexedDbMessageStore"));
      }, openTimeoutMs);

      void rawDbPromise.then(
        (db) => {
          if (settled) {
            this.#reportMetric("open", {
              status: "late-success",
              durationMs: performance.now() - openStartedAt,
            });
            log.info("IndexedDbMessageStore open completed after availability timeout", {
              dbName: this.#dbName,
              durationMs: performance.now() - openStartedAt,
            });
            db.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          log.debug("IndexedDbMessageStore opened", {
            dbName: this.#dbName,
            durationMs: performance.now() - openStartedAt,
          });
          this.#reportMetric("open", {
            status: "succeeded",
            durationMs: performance.now() - openStartedAt,
          });
          resolve(db);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.#reportMetric("open", {
            status: "failed",
            stage: openStage,
            durationMs: performance.now() - openStartedAt,
          });
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

    this.#initPromise = this.#initialize();
    void this.#initPromise.catch(() => undefined);
  }

  #reportMetric(event: string, data: MessageCacheMetricData): void {
    try {
      this.#metricSink?.(event, { kind: this.#kind, ...data });
    } catch (error) {
      log.debug("Message cache metric sink failed", { event, error });
    }
  }

  async #initialize(): Promise<void> {
    try {
      await this.#dbPromise;
      if (this.#shouldStopInitialization()) {
        log.debug("Skipping IndexedDbMessageStore initialization because store is already closed");
        return;
      }
      await this.#awaitInitializationStage(
        this.#configureStorageBudget({ allowPressureRecovery: !this.#maintenanceOnly }),
        "storage estimate",
      );
      if (this.#shouldStopInitialization()) {
        return;
      }
      if (this.#maintenanceOnly) {
        return;
      }
      await this.#awaitInitializationStage(this.#recordSessionCreation(), "session creation");
      if (this.#shouldStopInitialization()) {
        return;
      }
      await this.#awaitInitializationStage(this.#loadExistingMessageStats(), "message statistics");
      await this.#awaitInitializationStage(
        this.#checkLogicalBudgetAtInitialization(),
        "logical cache budget check",
      );
      log.info("IndexedDbMessageStore initialized", {
        dbName: this.#dbName,
        sessionId: this.#currentSessionId,
        maxCacheSize: this.#maxCacheSize,
        writesDisabled: this.#writesDisabled,
      });
      this.#reportMetric("session", {
        status: "active",
        maxCacheSize: this.#maxCacheSize,
        writesDisabled: this.#writesDisabled,
      });
      this.#scheduleBackgroundMaintenance();
    } catch (error) {
      log.error("Failed to initialize IndexedDbMessageStore:", error);
      // Do not queue another transaction here: the stage that timed out may itself be an IDB
      // transaction that never settles. Closing the connection is synchronous once open and lets
      // init reject at the business deadline; the janitor will classify any leftover active
      // session by age on a later pass.
      this.#unavailable = true;
      this.#closed = true;
      this.#abortActiveTransactions();
      await this.#closeDatabaseConnection();
      if (!this.#maintenanceOnly) {
        scheduleMessageCacheJanitor(this.#kind, this.#metricSink);
      }
      throw toError(error);
    }
  }

  #shouldStopInitialization(): boolean {
    return this.#closing || this.#closed || this.#unavailable;
  }

  async #awaitInitializationStage<T>(promise: Promise<T>, stage: string): Promise<T> {
    const remainingMs = this.#initializationDeadlineAt - performance.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out initializing IndexedDbMessageStore during ${stage}`);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.#reportMetric("open", { status: "timeout", stage });
        reject(new Error(`Timed out initializing IndexedDbMessageStore during ${stage}`));
      }, remainingMs);
    });
    try {
      return await race([promise, timeout]);
    } finally {
      if (timer != undefined) {
        clearTimeout(timer);
      }
    }
  }

  #scheduleBackgroundMaintenance(): void {
    if (
      this.#closing ||
      this.#closed ||
      this.#unavailable ||
      this.#backgroundMaintenanceCancel != undefined ||
      this.#backgroundMaintenancePromise != undefined
    ) {
      return;
    }

    const run = () => {
      this.#backgroundMaintenanceCancel = undefined;
      if (this.#closing || this.#closed || this.#unavailable) {
        return;
      }
      const maintenance = this.#runBackgroundMaintenance();
      this.#backgroundMaintenancePromise = maintenance;
      void maintenance.finally(() => {
        if (this.#backgroundMaintenancePromise === maintenance) {
          this.#backgroundMaintenancePromise = undefined;
        }
      });
    };

    const { requestIdleCallback, cancelIdleCallback } = getIdleSchedulingGlobal();
    if (requestIdleCallback != undefined && cancelIdleCallback != undefined) {
      const idleCallbackId = requestIdleCallback.call(globalThis, run, { timeout: 5_000 });
      this.#backgroundMaintenanceCancel = () => {
        cancelIdleCallback.call(globalThis, idleCallbackId);
      };
      return;
    }

    // Workers and test environments do not expose requestIdleCallback. Keep maintenance off the
    // startup path there as well, while still guaranteeing an eventual pass.
    const timer = setTimeout(run, 5_000);
    this.#backgroundMaintenanceCancel = () => {
      clearTimeout(timer);
    };
  }

  async #runBackgroundMaintenance(deadlineAt?: number): Promise<boolean> {
    try {
      const result = await runWithCacheMaintenanceLock(this.#dbName, this.#kind, async () => {
        await this.#runMaintenanceOperationWithDeadline(
          "background maintenance",
          async () => {
            await this.cleanupOldSessions(
              this.#kind,
              this.#kind === "playback-spill" ? PLAYBACK_SPILL_TTL_MS : THREE_DAYS_MS,
            );
            await this.#enforceGlobalBudgetImpl({ force: true });
          },
          { deadlineAt },
        );
      });
      if (!result.acquired) {
        this.#reportMetric("maintenance", { status: "lock-busy" });
        return false;
      }
      return true;
    } catch (error) {
      log.warn("IndexedDbMessageStore background maintenance failed", {
        dbName: this.#dbName,
        error,
      });
      return false;
    }
  }

  async #runMaintenanceOperationWithDeadline<T>(
    operationName: string,
    operation: () => Promise<T>,
    options: { deadlineAt?: number } = {},
  ): Promise<T> {
    const startedAt = performance.now();
    const timeoutMs = Math.max(
      0,
      (options.deadlineAt ?? startedAt + this.#maintenanceTimeoutMs) - startedAt,
    );
    const operationPromise = Promise.resolve().then(operation);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await race([
        operationPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new MaintenanceTimeoutError(
              `Timed out waiting for IndexedDbMessageStore ${operationName}`,
            );
            this.#writesDisabled = true;
            this.#unavailable = true;
            this.#storageEstimateGeneration++;
            this.#abortActiveTransactions();
            // Releasing the Web Lock must not depend on the overdue operation settling. Closing
            // the connection aborts compliant IndexedDB requests, while the deadline race lets
            // the lock callback return even if a browser promise remains permanently pending.
            void this.#dbPromise.then(
              (db) => {
                db.close();
              },
              () => undefined,
            );
            this.#reportMetric("maintenance", {
              status: "timeout",
              operation: operationName,
              durationMs: performance.now() - startedAt,
            });
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout != undefined) {
        clearTimeout(timeout);
      }
    }
  }

  /**
   * Run the same TTL, pressure, and global-budget pass from an idle maintenance-only store.
   * Returns when another pass should run if pressure is currently protecting a fresh active
   * session that may belong to another tab.
   */
  public async runMaintenance(): Promise<number | undefined> {
    if (!this.#maintenanceOnly) {
      throw new Error("runMaintenance requires a maintenance-only IndexedDbMessageStore");
    }
    const deadlineAt = performance.now() + this.#maintenanceTimeoutMs;
    const maintenanceRan = await this.#runBackgroundMaintenance(deadlineAt);
    if (!maintenanceRan) {
      return 1_000;
    }

    return await this.#runMaintenanceOperationWithDeadline(
      "maintenance retry calculation",
      async () => {
        if (this.#shouldAbortMaintenance()) {
          return undefined;
        }
        const db = await this.#dbPromise;
        const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
        const sessions: CacheSessionMetadata[] = [];
        for await (const cursor of tx.store.index("byKind").iterate(this.#kind)) {
          sessions.push(cursor.value);
        }
        await tx.done;
        const totalBytes = sessions.reduce(
          (total, session) => total + normalizedStoredSize(session.approximateSizeBytes),
          0,
        );
        if (!this.#writesDisabled && totalBytes <= this.#globalBudgetBytes) {
          return undefined;
        }

        const staleAfterMs =
          this.#kind === "playback-spill" ? PLAYBACK_SPILL_PRESSURE_STALE_MS : THREE_DAYS_MS;
        const now = Date.now();
        const nextStaleAt = sessions
          .filter(
            (session) => session.status === "active" && session.lastActiveAt + staleAfterMs > now,
          )
          .reduce<number | undefined>((earliest, session) => {
            const staleAt = session.lastActiveAt + staleAfterMs;
            return earliest == undefined ? staleAt : Math.min(earliest, staleAt);
          }, undefined);
        return nextStaleAt == undefined ? undefined : Math.max(1_000, nextStaleAt - now + 1_000);
      },
      { deadlineAt },
    );
  }

  async #stopBackgroundMaintenance(): Promise<void> {
    this.#backgroundMaintenanceCancel?.();
    this.#backgroundMaintenanceCancel = undefined;
    try {
      await this.#backgroundMaintenancePromise;
    } catch (error) {
      log.debug("IndexedDbMessageStore maintenance stopped with an error", error);
    }
  }

  async #settleShutdownOperation<T>(
    operation: Promise<T>,
    operationName: string,
    options: { reserveRemainingMs?: number } = {},
  ): Promise<PromiseSettledResult<T>> {
    const timeoutMs = Math.max(
      0,
      (this.#shutdownDeadlineAt == undefined
        ? this.#shutdownTimeoutMs
        : this.#shutdownDeadlineAt - performance.now()) - (options.reserveRemainingMs ?? 0),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new ShutdownTimeoutError(
                `Timed out waiting for IndexedDbMessageStore ${operationName}`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
      return { status: "fulfilled", value };
    } catch (error) {
      if (error instanceof ShutdownTimeoutError) {
        this.#reportMetric("close", { status: "timeout", operation: operationName });
        log.warn("IndexedDbMessageStore shutdown deadline exceeded", {
          dbName: this.#dbName,
          operation: operationName,
        });
        this.#abortActiveTransactions();
      }
      return { status: "rejected", reason: error };
    } finally {
      if (timeout != undefined) {
        clearTimeout(timeout);
      }
    }
  }

  #beginShutdown(): void {
    this.#shutdownDeadlineAt ??= performance.now() + this.#shutdownTimeoutMs;
  }

  #shutdownStatusReserveMs(): number {
    return Math.min(MAX_SHUTDOWN_STATUS_RESERVE_MS, this.#shutdownTimeoutMs / 2);
  }

  #trackTransaction<T extends ActiveTransaction>(
    transaction: T,
    options: { allowWhileClosing?: boolean } = {},
  ): T {
    if (
      (this.#closing || this.#closed || this.#unavailable) &&
      options.allowWhileClosing !== true
    ) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have auto-committed between creation and this check.
      }
      throw new Error("IndexedDbMessageStore is closing and cannot start another transaction");
    }

    this.#activeTransactions.add(transaction);
    void transaction.done.then(
      () => {
        this.#activeTransactions.delete(transaction);
      },
      () => {
        this.#activeTransactions.delete(transaction);
      },
    );
    return transaction;
  }

  #abortActiveTransactions(): void {
    for (const transaction of this.#activeTransactions) {
      try {
        transaction.abort();
      } catch (error) {
        log.debug("Failed to abort an overdue IndexedDB transaction", error);
      }
    }
  }

  async #waitForActiveTransactions(): Promise<void> {
    const transactions = Array.from(this.#activeTransactions);
    const results = await Promise.allSettled(
      transactions.map(async (transaction) => await transaction.done),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
  }

  async #configureStorageBudget({
    allowPressureRecovery = false,
    estimateTimeoutMs,
  }: { allowPressureRecovery?: boolean; estimateTimeoutMs?: number } = {}): Promise<void> {
    const estimateGeneration = ++this.#storageEstimateGeneration;
    const highPressureEpochAtStart = storagePressureHighEpoch;
    const pressureTokenAtStart = readStoragePressureToken();
    const recoveryGeneration = allowPressureRecovery
      ? ++storagePressureRecoveryGeneration
      : undefined;
    this.#originUsageBytes = undefined;
    this.#originQuotaBytes = undefined;
    const fallback =
      this.#kind === "playback-spill"
        ? PLAYBACK_BUDGET_FALLBACK_BYTES
        : REALTIME_BUDGET_FALLBACK_BYTES;
    const ratio = this.#kind === "playback-spill" ? PLAYBACK_BUDGET_RATIO : REALTIME_BUDGET_RATIO;
    const maximum =
      this.#kind === "playback-spill" ? PLAYBACK_BUDGET_MAX_BYTES : REALTIME_BUDGET_MAX_BYTES;

    let budget = fallback;
    const runtimeNavigator = (globalThis as { navigator?: Navigator }).navigator;
    const storageManager = runtimeNavigator?.storage as
      | { estimate?: () => Promise<StorageEstimate> }
      | undefined;
    if (storageManager?.estimate != undefined) {
      try {
        const estimateOperation = storageManager.estimate();
        let estimate: StorageEstimate;
        if (estimateTimeoutMs == undefined) {
          estimate = await estimateOperation;
        } else {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            estimate = await race([
              estimateOperation,
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => {
                  reject(
                    new StorageEstimateTimeoutError(
                      "Timed out estimating browser storage for cache maintenance",
                    ),
                  );
                }, estimateTimeoutMs);
              }),
            ]);
          } finally {
            if (timeout != undefined) {
              clearTimeout(timeout);
            }
          }
        }
        if (
          estimateGeneration === this.#storageEstimateGeneration &&
          !this.#closed &&
          !this.#unavailable
        ) {
          const quota = estimate.quota;
          const usage = estimate.usage;
          if (quota != undefined && Number.isFinite(quota) && quota > 0) {
            this.#originQuotaBytes = quota;
            this.#originUsageBytes =
              usage != undefined && Number.isFinite(usage) ? Math.max(0, usage) : undefined;
            budget = Math.min(maximum, quota * ratio);
            const usageRatio =
              usage != undefined && Number.isFinite(usage) ? Math.max(0, usage / quota) : undefined;
            if (usageRatio != undefined && usageRatio >= STORAGE_PRESSURE_HIGH_WATERMARK) {
              storagePressureHighEpoch++;
              await latchStoragePressure();
            } else if (
              allowPressureRecovery &&
              usageRatio != undefined &&
              usageRatio < STORAGE_PRESSURE_LOW_WATERMARK &&
              recoveryGeneration === storagePressureRecoveryGeneration &&
              highPressureEpochAtStart === storagePressureHighEpoch
            ) {
              await clearStoragePressureLatchIfUnchanged(pressureTokenAtStart);
            }
            if (isStoragePressureLatched()) {
              this.#writesDisabled = true;
            }
            log.debug("IndexedDbMessageStore storage estimate", {
              dbName: this.#dbName,
              kind: this.#kind,
              usage,
              quota,
              usageRatio,
              budget,
              writesDisabled: this.#writesDisabled,
            });
            this.#reportMetric("storage", {
              usage,
              quota,
              usageRatio,
              budget,
              writesDisabled: this.#writesDisabled,
            });
          }
        } else {
          log.debug("Ignoring a stale browser storage estimate", {
            dbName: this.#dbName,
            kind: this.#kind,
          });
        }
      } catch (error) {
        if (
          error instanceof StorageEstimateTimeoutError &&
          estimateGeneration === this.#storageEstimateGeneration &&
          !this.#closed &&
          !this.#unavailable
        ) {
          // The StorageManager request cannot be cancelled. Fail this cache generation closed so
          // a wedged browser storage backend cannot hold append/flush/close forever.
          this.#writesDisabled = true;
          storagePressureHighEpoch++;
          await latchStoragePressure();
          this.#reportMetric("storage", {
            status: "timeout",
            writesDisabled: true,
          });
        }
        log.debug("Failed to estimate browser storage; using fallback cache budget", error);
      }
    }

    if (isStoragePressureLatched()) {
      this.#writesDisabled = true;
    }

    if (this.#kind === "playback-spill" && budget < PLAYBACK_BUDGET_MIN_BYTES) {
      this.#writesDisabled = true;
    }
    this.#globalBudgetBytes = Math.max(0, budget);
    this.#maxCacheSize = Math.max(
      0,
      Math.min(this.#configuredMaxCacheSize ?? Number.POSITIVE_INFINITY, this.#globalBudgetBytes),
    );
  }

  async #loadExistingMessageStats(): Promise<void> {
    try {
      if (this.#closed) {
        return;
      }
      const db = await this.#dbPromise;
      const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readonly"));
      const messageIndex = tx.objectStore(STORE).index("bySession");
      const sessionMetadata = await tx.objectStore(SESSIONS_STORE).get(this.#currentSessionId);
      const count =
        sessionMetadata?.messageCount ?? (await messageIndex.count(this.#currentSessionId));
      const approximateSizeBytes = normalizedStoredSize(sessionMetadata?.approximateSizeBytes);
      const contentRevision = normalizedContentRevision(sessionMetadata?.contentRevision);
      await tx.done;

      this.#messageCount = count;
      this.#approximateSizeBytes = approximateSizeBytes;
      this.#contentRevision = Math.max(this.#contentRevision, contentRevision);
      log.debug(`Loaded existing message stats: ${count} messages`);

      if (sessionMetadata?.messageCount == undefined) {
        await this.#updateSessionMetadata({ messageCount: count, approximateSizeBytes });
      }
    } catch (error) {
      log.debug("Failed to load existing message stats:", error);
      throw error;
    }
  }

  async #checkLogicalBudgetAtInitialization(): Promise<void> {
    if (this.#shouldStopInitialization()) {
      return;
    }
    let totalBytes = 0;
    let sessionCount = 0;
    try {
      const db = await this.#dbPromise;
      const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
      const sessions = await tx.store.index("byKind").getAll(this.#kind);
      await tx.done;
      if (this.#shouldStopInitialization()) {
        return;
      }
      for (const session of sessions) {
        totalBytes += normalizedStoredSize(session.approximateSizeBytes);
      }
      sessionCount = sessions.length;
    } catch (error) {
      if (this.#shouldStopInitialization()) {
        return;
      }
      throw error;
    }

    if (totalBytes > this.#globalBudgetBytes) {
      this.#writesDisabled = true;
      this.#reportMetric("budget", {
        status: "over-budget-on-open",
        sessionCount,
        totalBytes,
        maxCacheSize: this.#globalBudgetBytes,
        writesDisabled: true,
      });
      log.warn("Disabling IndexedDbMessageStore writes until startup maintenance reclaims budget", {
        dbName: this.#dbName,
        kind: this.#kind,
        sessionCount,
        totalBytes,
        maxCacheSize: this.#globalBudgetBytes,
      });
    }
  }

  async #recordSessionCreation(): Promise<void> {
    try {
      if (this.#closed) {
        return;
      }
      const db = await this.#dbPromise;
      const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readwrite"));
      const store = tx.objectStore(SESSIONS_STORE);

      const now = Date.now();
      const existing = await store.get(this.#currentSessionId);
      if (existing?.status === "pending-delete" || existing?.status === "abandoned") {
        await tx.done;
        throw new Error("IndexedDbMessageStore session is pending cleanup and cannot be reopened");
      }
      const metadata: CacheSessionMetadata = {
        sessionId: this.#currentSessionId,
        kind: existing?.kind ?? this.#kind,
        createdAt: existing?.createdAt ?? now,
        lastActiveAt: now,
        sourceId: this.#sourceId ?? existing?.sourceId,
        topicFingerprint: this.#topicFingerprint ?? existing?.topicFingerprint,
        retentionWindowMs: this.#retentionWindowMs,
        maxBytes: this.#maxCacheSize,
        status: "active",
        owners: Array.from(new Set([...(existing?.owners ?? []), this.#ownerId])),
        contentRevision: normalizedContentRevision(
          existing?.contentRevision ?? this.#contentRevision,
        ),
        nextSeq: Math.max(existing?.nextSeq ?? 0, 0),
        approximateSizeBytes: normalizedStoredSize(existing?.approximateSizeBytes),
        messageCount: existing?.messageCount,
      };

      this.#approximateSizeBytes = metadata.approximateSizeBytes;
      this.#messageCount = metadata.messageCount ?? 0;
      this.#contentRevision = metadata.contentRevision ?? 0;

      await store.put(metadata);
      await tx.done;
      log.debug(`Recorded session metadata: ${this.#currentSessionId}`);
    } catch (error) {
      log.error("Failed to record session metadata:", error);
      throw error;
    }
  }

  public async cleanupOldSessions(
    kind: CacheSessionKind = this.#kind,
    maxInactiveMs: number = kind === "playback-spill" ? PLAYBACK_SPILL_TTL_MS : THREE_DAYS_MS,
  ): Promise<void> {
    const cutoffTime = Date.now() - maxInactiveMs;
    let candidateCount = 0;
    let succeededCount = 0;
    let failedCount = 0;

    try {
      const db = await this.#dbPromise;
      const sessionsTx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
      const sessionsStore = sessionsTx.objectStore(SESSIONS_STORE);
      const candidates: CacheSessionMetadata[] = [];

      for await (const cursor of sessionsStore.index("byKind").iterate(kind)) {
        const session = cursor.value;
        if (
          session.status === "pending-delete" ||
          session.status === "abandoned" ||
          (session.sessionId !== this.#currentSessionId && session.lastActiveAt <= cutoffTime)
        ) {
          candidates.push(session);
        }
      }
      await sessionsTx.done;
      candidateCount = candidates.length;

      if (candidates.length === 0) {
        log.debug("No old sessions to clean up");
        this.#reportMetric("cleanup", {
          status: "succeeded",
          candidateCount: 0,
          succeededCount: 0,
          failedCount: 0,
        });
        return;
      }

      const statusPriority = (status: CacheSessionMetadata["status"]): number =>
        status === "pending-delete" ? 0 : status === "abandoned" ? 1 : 2;
      candidates.sort((left, right) => {
        const priorityDifference = statusPriority(left.status) - statusPriority(right.status);
        return priorityDifference !== 0
          ? priorityDifference
          : left.lastActiveAt - right.lastActiveAt;
      });

      log.info(`Cleaning up ${candidates.length} ${kind} reclaimable cache sessions`);
      for (const session of candidates) {
        if (this.#shouldAbortMaintenance()) {
          break;
        }
        try {
          const cleaned = await this.#cleanupSessionData(
            session.sessionId,
            { kind, cutoffTime },
            { abortWhenClosing: true },
          );
          if (cleaned) {
            succeededCount++;
          }
        } catch (error) {
          failedCount++;
          log.error(`Failed to cleanup cache session ${session.sessionId}; continuing`, error);
        }
      }
      this.#reportMetric("cleanup", {
        status: failedCount === 0 ? "succeeded" : "degraded",
        candidateCount,
        succeededCount,
        failedCount,
        interrupted: this.#shouldAbortMaintenance(),
      });
    } catch (error) {
      this.#reportMetric("cleanup", {
        status: "failed",
        candidateCount,
        succeededCount,
        failedCount: failedCount + 1,
      });
      log.error("Failed to cleanup old sessions:", error);
    }
  }

  async #cleanupSessionData(
    sessionId: string,
    staleGuard?: { kind: CacheSessionKind; cutoffTime: number },
    options: { abortWhenClosing?: boolean } = {},
  ): Promise<boolean> {
    try {
      const db = await this.#dbPromise;
      const cleanupToken = `cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sealTx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readwrite"));
      const sessionsStore = sealTx.objectStore(SESSIONS_STORE);
      const sessionMetadata = await sessionsStore.get(sessionId);
      if (sessionMetadata == undefined) {
        await sealTx.done;
        return false;
      }
      if (staleGuard != undefined) {
        if (
          sessionMetadata.kind !== staleGuard.kind ||
          (sessionMetadata.status === "active" &&
            sessionMetadata.lastActiveAt > staleGuard.cutoffTime)
        ) {
          await sealTx.done;
          return false;
        }
      }
      await sessionsStore.put({
        ...sessionMetadata,
        status: "pending-delete",
        cleanupToken,
      });
      await sealTx.done;

      while (options.abortWhenClosing !== true || !this.#closing) {
        const batchResult = await this.#deleteSessionMessageBatch(sessionId, cleanupToken);
        if (!batchResult.stillOwner) {
          return false;
        }
        if (!batchResult.deletedAny) {
          break;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      while (options.abortWhenClosing !== true || !this.#closing) {
        const batchResult = await this.#deleteSessionTopicBatch(sessionId, cleanupToken);
        if (!batchResult.stillOwner) {
          return false;
        }
        if (!batchResult.deletedAny) {
          break;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      while (options.abortWhenClosing !== true || !this.#closing) {
        const batchResult = await this.#deleteSessionLoadedRangeBatch(sessionId, cleanupToken);
        if (!batchResult.stillOwner) {
          return false;
        }
        if (!batchResult.deletedAny) {
          break;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      if (options.abortWhenClosing === true && this.#shouldAbortMaintenance()) {
        return false;
      }

      const metadataTx = this.#trackTransaction(
        db.transaction([DATATYPES_STORE, SESSIONS_STORE], "readwrite"),
      );
      const finalSessionMetadata = await metadataTx.objectStore(SESSIONS_STORE).get(sessionId);
      if (
        finalSessionMetadata?.status !== "pending-delete" ||
        finalSessionMetadata.cleanupToken !== cleanupToken
      ) {
        await metadataTx.done;
        return false;
      }
      await metadataTx.objectStore(DATATYPES_STORE).delete(sessionId);
      await metadataTx.objectStore(SESSIONS_STORE).delete(sessionId);
      await metadataTx.done;
      if (sessionId === this.#currentSessionId) {
        this.#messageCount = 0;
        this.#approximateSizeBytes = 0;
      }
      log.debug(`Cleaned up all data for session: ${sessionId}`);
      return true;
    } catch (error) {
      log.error(`Failed to cleanup session data for ${sessionId}:`, error);
      throw error;
    }
  }

  async #deleteSessionMessageBatch(
    sessionId: string,
    cleanupToken: string,
  ): Promise<CleanupBatchResult> {
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readwrite"));
    const messageStore = tx.objectStore(STORE);
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const metadata = await sessionsStore.get(sessionId);
    if (metadata?.status !== "pending-delete" || metadata.cleanupToken !== cleanupToken) {
      await tx.done;
      return { deletedAny: false, stillOwner: false };
    }
    const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
    let deletedBytes = 0;

    for await (const cursor of messageStore.index("bySession").iterate(sessionId)) {
      const messageBytes = storedEventSize(cursor.value);
      if (
        keys.length > 0 &&
        (keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
          deletedBytes + messageBytes > CLEANUP_BATCH_MAX_BYTES)
      ) {
        break;
      }
      keys.push(cursor.primaryKey);
      deletedBytes += messageBytes;
      if (keys.length >= CLEANUP_BATCH_MAX_MESSAGES || deletedBytes >= CLEANUP_BATCH_MAX_BYTES) {
        break;
      }
    }

    for (const key of keys) {
      await messageStore.delete(key);
    }

    if (keys.length > 0) {
      await sessionsStore.put({
        ...metadata,
        approximateSizeBytes: Math.max(
          0,
          normalizedStoredSize(metadata.approximateSizeBytes) - deletedBytes,
        ),
        messageCount:
          metadata.messageCount == undefined
            ? undefined
            : Math.max(0, metadata.messageCount - keys.length),
      });
    }
    await tx.done;
    return { deletedAny: keys.length > 0, stillOwner: true };
  }

  async #deleteSessionTopicBatch(
    sessionId: string,
    cleanupToken: string,
  ): Promise<CleanupBatchResult> {
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction([TOPICS_STORE, SESSIONS_STORE], "readwrite"));
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const metadata = await sessionsStore.get(sessionId);
    if (metadata?.status !== "pending-delete" || metadata.cleanupToken !== cleanupToken) {
      await tx.done;
      return { deletedAny: false, stillOwner: false };
    }

    const topicsStore = tx.objectStore(TOPICS_STORE);
    const keys: [sessionId: string, name: string][] = [];
    let estimatedBytes = 0;
    for await (const cursor of topicsStore.index("bySession").iterate(sessionId)) {
      const value = cursor.value;
      const topicBytes =
        512 +
        (value.name.length +
          (value.schemaName?.length ?? 0) +
          (value.messageEncoding?.length ?? 0) +
          (value.schemaEncoding?.length ?? 0)) *
          2 +
        (value.schemaData?.byteLength ?? 0);
      if (
        keys.length > 0 &&
        (keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
          estimatedBytes + topicBytes > CLEANUP_BATCH_MAX_BYTES)
      ) {
        break;
      }
      keys.push(cursor.primaryKey);
      estimatedBytes += topicBytes;
      if (keys.length >= CLEANUP_BATCH_MAX_MESSAGES || estimatedBytes >= CLEANUP_BATCH_MAX_BYTES) {
        break;
      }
    }
    for (const key of keys) {
      await topicsStore.delete(key);
    }
    await tx.done;
    return { deletedAny: keys.length > 0, stillOwner: true };
  }

  async #deleteSessionLoadedRangeBatch(
    sessionId: string,
    cleanupToken: string,
  ): Promise<CleanupBatchResult> {
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(
      db.transaction([LOADED_RANGES_STORE, SESSIONS_STORE], "readwrite"),
    );
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const metadata = await sessionsStore.get(sessionId);
    if (metadata?.status !== "pending-delete" || metadata.cleanupToken !== cleanupToken) {
      await tx.done;
      return { deletedAny: false, stillOwner: false };
    }

    const rangesStore = tx.objectStore(LOADED_RANGES_STORE);
    const keys: string[] = [];
    let estimatedBytes = 0;
    for await (const cursor of rangesStore.index("bySession").iterate(sessionId)) {
      const rangeBytes = 512 + cursor.value.topicFingerprint.length * 2;
      if (
        keys.length > 0 &&
        (keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
          estimatedBytes + rangeBytes > CLEANUP_BATCH_MAX_BYTES)
      ) {
        break;
      }
      keys.push(cursor.primaryKey);
      estimatedBytes += rangeBytes;
      if (keys.length >= CLEANUP_BATCH_MAX_MESSAGES || estimatedBytes >= CLEANUP_BATCH_MAX_BYTES) {
        break;
      }
    }
    for (const key of keys) {
      await rangesStore.delete(key);
    }
    await tx.done;
    return { deletedAny: keys.length > 0, stillOwner: true };
  }

  public async init(): Promise<void> {
    await this.#initPromise;
  }

  public getSessionId(): string {
    return this.#currentSessionId;
  }

  public getRetentionWindowMs(): number {
    return this.#retentionWindowMs;
  }

  public setRetentionWindowMs(durationMs: number): void {
    this.#retentionWindowMs = durationMs;
    void this.#updateSessionMetadata({ retentionWindowMs: durationMs }).catch((error: unknown) => {
      log.debug("Failed to update retentionWindowMs metadata:", error);
    });
  }

  public getMaxCacheSize(): number {
    return this.#maxCacheSize;
  }

  /** Whether callers may still persist messages and coverage metadata in this session. */
  public isWritable(): boolean {
    return (
      !this.#closing &&
      !this.#closed &&
      !this.#unavailable &&
      !this.#writesDisabled &&
      this.#writeFailure == undefined
    );
  }

  /** Changes whenever messages are removed or a write can no longer be trusted as complete. */
  public getContentRevision(): number {
    return this.#contentRevision;
  }

  #assertWritable(operation: string): void {
    if (this.#writeFailure != undefined) {
      throw this.#writeFailure;
    }
    if (!this.isWritable()) {
      throw new Error(`Cannot ${operation}: IndexedDbMessageStore is not writable`);
    }
  }

  #clearAppendQueue(): void {
    this.#appendQueue.length = 0;
    this.#appendQueueEstimatedBytes = 0;
  }

  #recordWriteFailure(error: unknown, operation: string): Error {
    const failure = toError(error);
    if (this.#writeFailure == undefined) {
      this.#writeFailure = failure;
      this.#contentRevision++;
      log.warn("Disabling IndexedDbMessageStore writes after a persistence failure", {
        dbName: this.#dbName,
        operation,
        error: failure,
      });
      this.#reportMetric("write", { status: "failed", operation });
    }
    if (this.#appendFlushTimer != undefined) {
      clearTimeout(this.#appendFlushTimer);
      this.#appendFlushTimer = undefined;
    }
    this.#clearAppendQueue();
    return this.#writeFailure;
  }

  #markContentRemoved(count: number): void {
    if (count > 0) {
      this.#contentRevision++;
    }
  }

  #sessionPruneTargetSize(): number {
    return Math.min(
      this.#maxCacheSize * 0.9,
      this.#globalBudgetBytes * GLOBAL_BUDGET_LOW_WATERMARK,
    );
  }

  async #failAfterPruneError(error: unknown): Promise<never> {
    // Multi-batch pruning can commit some deletions before a later batch fails. Invalidate all
    // playback coverage even when the exact number of committed deletions is unknown.
    this.#contentRevision++;
    try {
      await this.#deleteLoadedRangesAfterPrune();
    } catch (rangeError) {
      log.warn("Failed to invalidate loaded ranges after a pruning error", {
        dbName: this.#dbName,
        error: rangeError,
      });
    }
    throw toError(error);
  }

  public setMaxCacheSize(sizeBytes: number): void {
    const validatedMaxCacheSize = validatedSize(sizeBytes, "maxCacheSize");
    this.#configuredMaxCacheSize = validatedMaxCacheSize;
    this.#maxCacheSize = Math.min(this.#globalBudgetBytes, validatedMaxCacheSize);
    void this.#updateSessionMetadata({ maxBytes: this.#maxCacheSize }).catch((error: unknown) => {
      log.debug("Failed to update maxBytes metadata:", error);
    });
  }

  public async setTopicFingerprint(topicFingerprint: string): Promise<void> {
    await this.#initPromise;
    this.#assertWritable("set the topic fingerprint");
    await this.#updateSessionMetadata({ topicFingerprint });
    this.#topicFingerprint = topicFingerprint;
  }

  public async getSessionMetadata(): Promise<CacheSessionMetadata | undefined> {
    if (this.#closed) {
      return undefined;
    }
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
    const result = await tx.store.get(this.#currentSessionId);
    await tx.done;
    return result;
  }

  public async touchSession(): Promise<boolean> {
    if (!this.isWritable()) {
      return false;
    }
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readwrite"));
    const store = tx.objectStore(SESSIONS_STORE);
    const existing = await store.get(this.#currentSessionId);
    if (existing == undefined) {
      await tx.done;
      return false;
    }
    if (existing.status !== "active") {
      await tx.done;
      return false;
    }
    await store.put({ ...existing, lastActiveAt: Date.now() });
    await tx.done;
    return true;
  }

  async #updateSessionMetadata(
    updates: Partial<Omit<CacheSessionMetadata, "sessionId" | "createdAt">>,
  ): Promise<void> {
    if (this.#closed) {
      return;
    }
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readwrite"));
    const store = tx.objectStore(SESSIONS_STORE);
    const existing = await store.get(this.#currentSessionId);
    if (existing != undefined) {
      await store.put({
        ...existing,
        ...updates,
        lastActiveAt: updates.lastActiveAt ?? Date.now(),
      });
    }
    await tx.done;
  }

  public async append(
    events: readonly MessageEvent[],
    options: PersistentMessageCacheAppendOptions = {},
  ): Promise<void> {
    if (
      options.estimatedSizeBytes != undefined &&
      options.estimatedSizeBytes.length !== events.length
    ) {
      throw new Error("estimatedSizeBytes length must match events length");
    }

    const queuedMessages = events.map((event, index): QueuedMessage => {
      const sizeInBytes = validatedSize(event.sizeInBytes, "MessageEvent.sizeInBytes");
      const suppliedEstimate = options.estimatedSizeBytes?.[index];
      const estimatedCacheBytes =
        suppliedEstimate == undefined
          ? sizeInBytes
          : Math.max(sizeInBytes, validatedSize(suppliedEstimate, `estimatedSizeBytes[${index}]`));
      return { event, estimatedCacheBytes };
    });
    if (queuedMessages.length === 0) {
      return;
    }
    await this.#initPromise;
    this.#assertWritable("append messages");
    const oversizedMessage = queuedMessages.find(
      (queued) => queued.estimatedCacheBytes > this.#appendBatchMaxBytes,
    );
    if (oversizedMessage != undefined) {
      throw this.#recordWriteFailure(
        new Error(
          `A message's ${oversizedMessage.estimatedCacheBytes}-byte cache estimate exceeds the ${this.#appendBatchMaxBytes}-byte append transaction limit`,
        ),
        "queue oversized message",
      );
    }
    const addedEstimatedBytes = queuedMessages.reduce(
      (total, queued) => total + queued.estimatedCacheBytes,
      0,
    );
    this.#appendQueue.push(...queuedMessages);
    this.#appendQueueEstimatedBytes += addedEstimatedBytes;
    const overflowCount = this.#appendQueue.length - this.#maxQueuedMessages;
    if (overflowCount > 0 || this.#appendQueueEstimatedBytes > this.#maxQueuedBytes) {
      throw this.#recordWriteFailure(
        new Error(
          `IndexedDbMessageStore append queue exceeded its ${this.#maxQueuedMessages}-message or ${this.#maxQueuedBytes}-byte limit; refusing incomplete cache writes`,
        ),
        "queue messages",
      );
    }

    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    const flushImmediately =
      this.#appendQueue.length >= this.#appendBatchMaxSize ||
      this.#appendQueueEstimatedBytes >= this.#appendBatchMaxBytes;
    if (this.#appendFlushTimer != undefined) {
      if (!flushImmediately || this.#appendFlushInFlight != undefined) {
        return;
      }
      clearTimeout(this.#appendFlushTimer);
      this.#appendFlushTimer = undefined;
    }
    if (this.#appendFlushInFlight != undefined) {
      return;
    }
    this.#appendFlushTimer = setTimeout(
      () => {
        this.#appendFlushTimer = undefined;
        this.#appendFlushInFlight = this.#flushQueuedAppends();
        void this.#appendFlushInFlight.then(
          () => {
            this.#appendFlushInFlight = undefined;
            if (this.#appendQueue.length > 0 && !this.#closing && !this.#closed) {
              this.#scheduleFlush();
            }
          },
          (error: unknown) => {
            this.#recordWriteFailure(error, "flush queued messages");
            this.#appendFlushInFlight = undefined;
          },
        );
      },
      flushImmediately ? 0 : this.#appendBatchMaxDelayMs,
    );
  }

  public async flush(): Promise<void> {
    await this.#initPromise;
    if (this.#writeFailure != undefined) {
      throw this.#writeFailure;
    }
    if (this.#appendFlushTimer != undefined) {
      clearTimeout(this.#appendFlushTimer);
      this.#appendFlushTimer = undefined;
    }

    while (this.#appendQueue.length > 0 || this.#appendFlushInFlight != undefined) {
      if (this.#appendFlushInFlight != undefined) {
        try {
          await this.#appendFlushInFlight;
        } catch (error) {
          throw this.#recordWriteFailure(error, "flush queued messages");
        }
        continue;
      }
      this.#appendFlushInFlight = this.#flushQueuedAppends();
      try {
        await this.#appendFlushInFlight;
      } catch (error) {
        throw this.#recordWriteFailure(error, "flush queued messages");
      } finally {
        this.#appendFlushInFlight = undefined;
      }
    }
  }

  async #flushQueuedAppends(): Promise<void> {
    try {
      await this.#flushQueuedAppendsImpl();
    } catch (error) {
      throw this.#recordWriteFailure(error, "flush queued messages");
    }
  }

  async #flushQueuedAppendsImpl(): Promise<void> {
    let batchCount = 0;
    let batchEstimatedBytes = 0;
    for (const queued of this.#appendQueue) {
      if (batchCount >= this.#appendBatchMaxSize) {
        break;
      }
      if (
        batchCount > 0 &&
        batchEstimatedBytes + queued.estimatedCacheBytes > this.#appendBatchMaxBytes
      ) {
        break;
      }
      batchCount += 1;
      batchEstimatedBytes += queued.estimatedCacheBytes;
      if (batchEstimatedBytes >= this.#appendBatchMaxBytes) {
        break;
      }
    }
    const batch = this.#appendQueue.splice(0, batchCount);
    this.#appendQueueEstimatedBytes = Math.max(
      0,
      this.#appendQueueEstimatedBytes - batchEstimatedBytes,
    );
    if (batch.length === 0) {
      return;
    }

    if (this.#writeFailure != undefined) {
      throw this.#writeFailure;
    }
    if (this.#closed || this.#unavailable || this.#writesDisabled) {
      throw new Error("IndexedDbMessageStore became unavailable before queued messages flushed");
    }
    const db = await this.#dbPromise;

    const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readwrite"), {
      allowWhileClosing: true,
    });
    this.#activeAppendTransaction = tx;
    let latestTime: Time | undefined;
    let approximateSizeBytesAdded = 0;
    let seq = 0;
    let committedMessageCount = this.#messageCount;
    let committedApproximateSizeBytes = this.#approximateSizeBytes;

    try {
      const store = tx.objectStore(STORE);
      const sessionsStore = tx.objectStore(SESSIONS_STORE);
      const sessionId = this.#currentSessionId;
      const sessionData = await sessionsStore.get(sessionId);
      if (sessionData == undefined || sessionData.status !== "active") {
        await tx.done;
        throw new Error("IndexedDbMessageStore session is no longer active");
      }
      // The session row is the allocation authority. Readwrite transactions are serialized across
      // tabs so two writers reopening the same session cannot overwrite equal-timestamp keys.
      seq =
        Number.isSafeInteger(sessionData.nextSeq) && sessionData.nextSeq >= 0
          ? sessionData.nextSeq
          : 0;

      const putPromises: Promise<unknown>[] = [];
      for (const queued of batch) {
        const { event: ev, estimatedCacheBytes } = queued;
        latestTime =
          latestTime == undefined || isGreaterThan(ev.receiveTime, latestTime)
            ? ev.receiveTime
            : latestTime;
        approximateSizeBytesAdded += estimatedCacheBytes;
        putPromises.push(store.put(sanitizeEvent(sessionId, seq++, ev, estimatedCacheBytes)));
      }

      committedMessageCount = Math.max(0, (sessionData.messageCount ?? 0) + batch.length);
      committedApproximateSizeBytes = Math.max(
        0,
        normalizedStoredSize(sessionData.approximateSizeBytes) + approximateSizeBytesAdded,
      );
      putPromises.push(
        sessionsStore.put({
          ...sessionData,
          lastActiveAt: Date.now(),
          nextSeq: seq,
          messageCount: committedMessageCount,
          approximateSizeBytes: committedApproximateSizeBytes,
        }),
      );

      await Promise.all(putPromises);
      await tx.done;
    } finally {
      if (this.#activeAppendTransaction === tx) {
        this.#activeAppendTransaction = undefined;
      }
    }

    this.#messageCount = committedMessageCount;
    this.#approximateSizeBytes = committedApproximateSizeBytes;
    this.#bytesSinceGlobalBudgetCheck += approximateSizeBytesAdded;

    if (!this.#closing) {
      await this.#maybePrune(latestTime);
      await this.#enforceGlobalBudget();
    }
  }

  async #maybePrune(latestTime: Time | undefined): Promise<void> {
    if (latestTime == undefined || this.#closing || this.#closed || this.#unavailable) {
      return;
    }

    const now = Date.now();
    const shouldPrune =
      this.#lastPruneTime == undefined || now - this.#lastPruneTime >= this.#pruneIntervalMs;
    if (!shouldPrune) {
      return;
    }

    try {
      let totalPrunedCount = 0;

      const retentionWindowMsTime = fromMillis(this.#retentionWindowMs);
      const cutoff = subtract(latestTime, retentionWindowMsTime);
      const timePruneResult = await this.#pruneBeforeTime(this.#currentSessionId, cutoff);
      totalPrunedCount += timePruneResult.count;

      const approximateAfterTimePrune = this.#approximateSizeBytes;
      if (approximateAfterTimePrune > this.#maxCacheSize) {
        const sizePruneResult = await this.#pruneOldestUntilSize(
          this.#currentSessionId,
          this.#sessionPruneTargetSize(),
        );
        totalPrunedCount += sizePruneResult.count;
      }

      this.#lastPruneTime = now;

      if (totalPrunedCount > 0) {
        await this.#deleteLoadedRangesAfterPrune();
        log.debug(
          `Pruned ${totalPrunedCount} messages, approximate session size: ${Math.round(
            this.#approximateSizeBytes / 1024 / 1024,
          )}MB (limit: ${Math.round(this.#maxCacheSize / 1024 / 1024)}MB)`,
        );
      }
    } catch (error) {
      await this.#failAfterPruneError(error);
    }
  }

  async #enforceGlobalBudget(options: { force?: boolean } = {}): Promise<void> {
    const existing = this.#budgetEnforcementPromise;
    if (existing != undefined) {
      await existing;
      return;
    }
    const enforcement = this.#enforceGlobalBudgetWithLock(options);
    this.#budgetEnforcementPromise = enforcement;
    try {
      await enforcement;
    } finally {
      if (this.#budgetEnforcementPromise === enforcement) {
        this.#budgetEnforcementPromise = undefined;
      }
    }
  }

  async #enforceGlobalBudgetWithLock(options: { force?: boolean }): Promise<void> {
    const result = await runWithCacheMaintenanceLock(this.#dbName, this.#kind, async () => {
      await this.#runMaintenanceOperationWithDeadline("global budget enforcement", async () => {
        await this.#enforceGlobalBudgetImpl(options);
      });
    });
    if (!result.acquired) {
      this.#reportMetric("maintenance", { status: "lock-busy" });
      scheduleMessageCacheJanitor(this.#kind, this.#metricSink, 1_000);
    }
  }

  async #enforceGlobalBudgetImpl({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.#shouldAbortMaintenance()) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      this.#bytesSinceGlobalBudgetCheck < GLOBAL_BUDGET_CHECK_BYTES &&
      this.#lastGlobalBudgetCheck != undefined &&
      now - this.#lastGlobalBudgetCheck < GLOBAL_BUDGET_CHECK_INTERVAL_MS
    ) {
      return;
    }

    this.#lastGlobalBudgetCheck = now;
    this.#bytesSinceGlobalBudgetCheck = 0;
    await this.#configureStorageBudget({
      estimateTimeoutMs: PERIODIC_STORAGE_ESTIMATE_TIMEOUT_MS,
    });
    if (this.#shouldAbortMaintenance()) {
      return;
    }

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
    const sessions: CacheSessionMetadata[] = [];
    for await (const cursor of tx.store.index("byKind").iterate(this.#kind)) {
      sessions.push(cursor.value);
    }
    await tx.done;

    let totalBytes = sessions.reduce(
      (total, session) => total + normalizedStoredSize(session.approximateSizeBytes),
      0,
    );
    log.debug("IndexedDbMessageStore global budget state", {
      dbName: this.#dbName,
      kind: this.#kind,
      sessionCount: sessions.length,
      totalBytes,
      sessionMaxCacheSize: this.#maxCacheSize,
      globalBudgetBytes: this.#globalBudgetBytes,
      writesDisabled: this.#writesDisabled,
    });
    this.#reportMetric("budget", {
      sessionCount: sessions.length,
      totalBytes,
      maxCacheSize: this.#globalBudgetBytes,
      writesDisabled: this.#writesDisabled,
    });
    let targetBytes = this.#globalBudgetBytes * GLOBAL_BUDGET_LOW_WATERMARK;
    if (
      this.#writesDisabled &&
      this.#originUsageBytes != undefined &&
      this.#originQuotaBytes != undefined
    ) {
      const bytesToLowWatermark = Math.max(
        0,
        this.#originUsageBytes - this.#originQuotaBytes * STORAGE_PRESSURE_LOW_WATERMARK,
      );
      // Under origin pressure, ordinary cache-budget headroom is not enough: reclaim enough
      // disposable cache bytes to move the origin toward the 70% recovery watermark.
      targetBytes = Math.min(targetBytes, Math.max(0, totalBytes - bytesToLowWatermark));
    }
    const staleCutoff =
      now - (this.#kind === "playback-spill" ? PLAYBACK_SPILL_PRESSURE_STALE_MS : THREE_DAYS_MS);
    const reclaimable = sessions
      .filter(
        (session) =>
          session.sessionId !== this.#currentSessionId &&
          (session.status !== "active" || session.lastActiveAt <= staleCutoff),
      )
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt);

    const requiresReclaim = totalBytes > this.#globalBudgetBytes || this.#writesDisabled;
    if (!requiresReclaim) {
      return;
    }

    for (const session of reclaimable) {
      if (this.#shouldAbortMaintenance()) {
        return;
      }
      try {
        const cleaned = await this.#cleanupSessionData(
          session.sessionId,
          { kind: this.#kind, cutoffTime: staleCutoff },
          { abortWhenClosing: true },
        );
        if (cleaned) {
          totalBytes = Math.max(0, totalBytes - normalizedStoredSize(session.approximateSizeBytes));
        }
      } catch (error) {
        log.warn("Failed to reclaim an IndexedDbMessageStore session", {
          dbName: this.#dbName,
          sessionId: session.sessionId,
          error,
        });
      }
      if (totalBytes <= targetBytes) {
        break;
      }
    }

    if (this.#shouldAbortMaintenance() || totalBytes <= targetBytes) {
      return;
    }

    // Cleanup and appends from another connection may have changed the snapshot. Re-read before
    // pruning the current session so stale totals cannot over-reclaim or overwrite its metadata.
    const refreshedTx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
    const refreshedSessions: CacheSessionMetadata[] = [];
    for await (const cursor of refreshedTx.store.index("byKind").iterate(this.#kind)) {
      refreshedSessions.push(cursor.value);
    }
    await refreshedTx.done;
    totalBytes = refreshedSessions.reduce(
      (total, session) => total + normalizedStoredSize(session.approximateSizeBytes),
      0,
    );
    const currentSession = refreshedSessions.find(
      (session) => session.sessionId === this.#currentSessionId,
    );
    if (totalBytes <= targetBytes) {
      return;
    }
    if (currentSession == undefined) {
      if (totalBytes > this.#globalBudgetBytes) {
        this.#writesDisabled = true;
        log.warn("Disabling IndexedDbMessageStore writes because active sessions exceed budget", {
          dbName: this.#dbName,
          totalBytes,
          maxCacheSize: this.#globalBudgetBytes,
        });
      }
      return;
    }
    this.#messageCount = currentSession.messageCount ?? this.#messageCount;
    this.#approximateSizeBytes = normalizedStoredSize(currentSession.approximateSizeBytes);
    const otherSessionBytes = Math.max(0, totalBytes - this.#approximateSizeBytes);
    const currentTargetSize = Math.min(
      this.#maxCacheSize * 0.9,
      Math.max(0, targetBytes - otherSessionBytes),
    );
    let pruned: { count: number; bytes: number };
    try {
      pruned = await this.#pruneOldestUntilSize(this.#currentSessionId, currentTargetSize);
    } catch (error) {
      await this.#failAfterPruneError(error);
    }
    if (pruned.count > 0) {
      await this.#deleteLoadedRangesAfterPrune();
    }

    const finalTx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
    let finalTotalBytes = 0;
    for await (const cursor of finalTx.store.index("byKind").iterate(this.#kind)) {
      finalTotalBytes += normalizedStoredSize(cursor.value.approximateSizeBytes);
    }
    await finalTx.done;
    if (finalTotalBytes > this.#globalBudgetBytes) {
      this.#writesDisabled = true;
      log.warn("Disabling IndexedDbMessageStore writes because active sessions exceed budget", {
        dbName: this.#dbName,
        totalBytes: finalTotalBytes,
        maxCacheSize: this.#globalBudgetBytes,
      });
    }
  }

  #shouldAbortMaintenance(): boolean {
    return this.#closing || this.#closed || this.#unavailable;
  }

  async #pruneBeforeTime(
    sessionId: string,
    cutoff: Time,
  ): Promise<{ count: number; bytes: number }> {
    let totalCount = 0;
    let totalBytes = 0;

    while (!this.#closing) {
      const db = await this.#dbPromise;
      const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readwrite"));
      const messageStore = tx.objectStore(STORE);
      const sessionsStore = tx.objectStore(SESSIONS_STORE);
      const session = await sessionsStore.get(sessionId);
      if (session == undefined) {
        await tx.done;
        break;
      }
      const index = messageStore.index("bySessionTime");
      const range = IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [sessionId, cutoff.sec, cutoff.nsec],
      );
      const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
      let batchBytes = 0;
      for await (const cursor of index.iterate(range)) {
        const messageBytes = storedEventSize(cursor.value);
        if (
          keys.length > 0 &&
          (keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
            batchBytes + messageBytes > CLEANUP_BATCH_MAX_BYTES)
        ) {
          break;
        }
        keys.push(cursor.primaryKey);
        batchBytes += messageBytes;
        if (keys.length >= CLEANUP_BATCH_MAX_MESSAGES || batchBytes >= CLEANUP_BATCH_MAX_BYTES) {
          break;
        }
      }
      for (const key of keys) {
        await messageStore.delete(key);
      }
      const nextMessageCount = Math.max(0, (session.messageCount ?? 0) - keys.length);
      const nextApproximateSizeBytes = Math.max(
        0,
        normalizedStoredSize(session.approximateSizeBytes) - batchBytes,
      );
      const nextContentRevision =
        normalizedContentRevision(session.contentRevision) + (keys.length > 0 ? 1 : 0);
      if (keys.length > 0) {
        await sessionsStore.put({
          ...session,
          messageCount: nextMessageCount,
          approximateSizeBytes: nextApproximateSizeBytes,
          contentRevision: nextContentRevision,
        });
      }
      await tx.done;

      totalCount += keys.length;
      totalBytes += batchBytes;
      if (sessionId === this.#currentSessionId) {
        this.#messageCount = nextMessageCount;
        this.#approximateSizeBytes = nextApproximateSizeBytes;
        this.#contentRevision = Math.max(this.#contentRevision, nextContentRevision);
      }
      if (keys.length === 0) {
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    return { count: totalCount, bytes: totalBytes };
  }

  async #pruneOldestUntilSize(
    sessionId: string,
    targetSize: number,
  ): Promise<{ count: number; bytes: number }> {
    let totalDeletedCount = 0;
    let totalDeletedBytes = 0;
    const BATCH_SIZE = 100;

    while (!this.#closing) {
      const db = await this.#dbPromise;
      const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readwrite"));
      const messageStore = tx.objectStore(STORE);
      const sessionsStore = tx.objectStore(SESSIONS_STORE);
      const session = await sessionsStore.get(sessionId);
      if (session == undefined) {
        await tx.done;
        break;
      }
      const currentApproximateSize = normalizedStoredSize(session.approximateSizeBytes);
      if (currentApproximateSize <= targetSize) {
        await tx.done;
        if (sessionId === this.#currentSessionId) {
          this.#messageCount = session.messageCount ?? 0;
          this.#approximateSizeBytes = currentApproximateSize;
        }
        break;
      }
      const index = messageStore.index("bySessionTime");
      const range = IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      );

      const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
      let batchDeletedBytes = 0;

      for await (const cursor of index.iterate(range)) {
        const messageBytes = storedEventSize(cursor.value);
        if (
          keys.length > 0 &&
          (keys.length >= BATCH_SIZE || batchDeletedBytes + messageBytes > CLEANUP_BATCH_MAX_BYTES)
        ) {
          break;
        }
        keys.push(cursor.primaryKey);
        batchDeletedBytes += messageBytes;
        if (keys.length >= BATCH_SIZE || batchDeletedBytes >= CLEANUP_BATCH_MAX_BYTES) {
          break;
        }
      }

      for (const key of keys) {
        await messageStore.delete(key);
      }

      const nextMessageCount = Math.max(0, (session.messageCount ?? 0) - keys.length);
      const nextApproximateSizeBytes =
        keys.length === 0 ? 0 : Math.max(0, currentApproximateSize - batchDeletedBytes);
      const nextContentRevision =
        normalizedContentRevision(session.contentRevision) + (keys.length > 0 ? 1 : 0);
      if (keys.length > 0 || currentApproximateSize > 0 || (session.messageCount ?? 0) > 0) {
        await sessionsStore.put({
          ...session,
          messageCount: nextMessageCount,
          approximateSizeBytes: nextApproximateSizeBytes,
          contentRevision: nextContentRevision,
        });
      }

      await tx.done;

      if (sessionId === this.#currentSessionId) {
        this.#messageCount = nextMessageCount;
        this.#approximateSizeBytes = nextApproximateSizeBytes;
        this.#contentRevision = Math.max(this.#contentRevision, nextContentRevision);
      }

      if (keys.length === 0) {
        break;
      }

      totalDeletedCount += keys.length;
      totalDeletedBytes += batchDeletedBytes;
    }

    return { count: totalDeletedCount, bytes: totalDeletedBytes };
  }

  async #deleteLoadedRangesAfterPrune(): Promise<void> {
    if (this.#kind === "playback-spill") {
      await this.deleteLoadedRanges();
    }
  }

  public async getMessages(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    limit?: number;
  }): Promise<readonly MessageEvent[]> {
    return (await this.#getMessagesImpl(params)) ?? [];
  }

  /** Reads a range only when its persisted estimate fits the caller's hydration budget. */
  public async getMessagesWithinSize(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    maxEstimatedBytes: number;
  }): Promise<readonly MessageEvent[] | undefined> {
    const maxEstimatedBytes = validatedSize(params.maxEstimatedBytes, "maxEstimatedBytes");
    return await this.#getMessagesImpl(params, maxEstimatedBytes, {
      requireActiveSession: true,
    });
  }

  /**
   * Reads a bounded page directly from the primary message key. The cursor includes the append
   * sequence so pagination remains lossless when many messages share the same receive timestamp.
   */
  public async getMessagesPage(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    maxEstimatedBytes: number;
    after?: MessagePageCursor;
  }): Promise<MessagePage | undefined> {
    const maxEstimatedBytes = validatedSize(params.maxEstimatedBytes, "maxEstimatedBytes");
    if (
      params.after != undefined &&
      (!Number.isSafeInteger(params.after.seq) || params.after.seq < 0)
    ) {
      throw new Error("after.seq must be a non-negative safe integer");
    }
    if (this.#closed) {
      log.debug("Skipping getMessagesPage - store has been closed");
      return { messages: [], complete: true };
    }

    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readonly"));
    const session = await tx.objectStore(SESSIONS_STORE).get(sessionId);
    if (session?.status !== "active") {
      await tx.done;
      return undefined;
    }

    const lowerKey: [string, number, number, number] = params.after
      ? [sessionId, params.after.receiveTime.sec, params.after.receiveTime.nsec, params.after.seq]
      : [sessionId, params.start.sec, params.start.nsec, Number.MIN_SAFE_INTEGER];
    const upperKey: [string, number, number, number] = [
      sessionId,
      params.end.sec,
      params.end.nsec,
      Number.MAX_SAFE_INTEGER,
    ];
    const range = IDBKeyRange.bound(lowerKey, upperKey, params.after != undefined, false);
    const topicSet = params.topics ? new Set(params.topics) : undefined;
    const messages: MessageEvent[] = [];
    let estimatedBytes = 0;
    let scannedRecords = 0;
    let nextCursor: MessagePageCursor | undefined;
    let complete = true;

    for await (const cursor of tx.objectStore(STORE).iterate(range)) {
      const value = cursor.value;
      const currentCursor: MessagePageCursor = {
        receiveTime: value.receiveTime,
        seq: value.seq,
      };
      scannedRecords++;

      if (topicSet == undefined || topicSet.has(value.topic)) {
        const messageBytes = storedEventSize(value);
        // Always make progress for one indivisible message, even when that message alone is larger
        // than the requested page budget.
        if (messages.length > 0 && estimatedBytes + messageBytes > maxEstimatedBytes) {
          complete = false;
          break;
        }
        messages.push(restoreEvent(value));
        estimatedBytes += messageBytes;
      }

      nextCursor = currentCursor;
      if (scannedRecords >= MESSAGE_READ_PAGE_MAX_SCANNED_RECORDS) {
        complete = false;
        break;
      }
    }
    await tx.done;

    if (!complete && nextCursor == undefined) {
      throw new Error("IndexedDbMessageStore pagination failed to advance");
    }
    return {
      messages,
      ...(complete ? {} : { nextCursor }),
      complete,
    };
  }

  async #getMessagesImpl(
    params: {
      start: Time;
      end: Time;
      topics?: readonly string[];
      limit?: number;
    },
    maxEstimatedBytes?: number,
    options: { requireActiveSession?: boolean } = {},
  ): Promise<readonly MessageEvent[] | undefined> {
    if (this.#closed) {
      log.debug("Skipping getMessages - store has been closed");
      return [];
    }

    const { start, end, topics, limit } = params;
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;

    const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readonly"));
    if (options.requireActiveSession === true) {
      const session = await tx.objectStore(SESSIONS_STORE).get(sessionId);
      if (session?.status !== "active") {
        await tx.done;
        return undefined;
      }
    }
    const index = tx.objectStore(STORE).index("bySessionTime");
    const range = IDBKeyRange.bound(
      [sessionId, start.sec, start.nsec],
      [sessionId, end.sec, end.nsec],
    );

    const topicSet = topics ? new Set(topics) : undefined;
    const out: MessageEvent[] = [];
    let estimatedBytes = 0;
    let exceededSizeLimit = false;
    for await (const cursor of index.iterate(range)) {
      const value = cursor.value;
      if (topicSet && !topicSet.has(value.topic)) {
        continue;
      }
      estimatedBytes += storedEventSize(value);
      if (maxEstimatedBytes != undefined && estimatedBytes > maxEstimatedBytes) {
        exceededSizeLimit = true;
        break;
      }
      out.push(restoreEvent(value));
      if (limit != undefined && out.length >= limit) {
        break;
      }
    }
    await tx.done;
    return exceededSizeLimit ? undefined : out;
  }

  public async deleteMessages(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
  }): Promise<void> {
    if (this.#closed) {
      log.debug("Skipping deleteMessages - store has been closed");
      return;
    }

    const { start, end, topics } = params;
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction([STORE, SESSIONS_STORE], "readwrite"));
    const index = tx.objectStore(STORE).index("bySessionTime");
    const range = IDBKeyRange.bound(
      [sessionId, start.sec, start.nsec],
      [sessionId, end.sec, end.nsec],
    );
    const topicSet = topics ? new Set(topics) : undefined;
    const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
    let bytes = 0;

    for await (const cursor of index.iterate(range)) {
      const value = cursor.value;
      if (topicSet && !topicSet.has(value.topic)) {
        continue;
      }
      keys.push(cursor.primaryKey);
      bytes += storedEventSize(value);
    }

    const messageStore = tx.objectStore(STORE);
    for (const key of keys) {
      await messageStore.delete(key);
    }

    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const sessionData = await sessionsStore.get(sessionId);
    if (sessionData != undefined && keys.length > 0) {
      const messageCount = Math.max(0, (sessionData.messageCount ?? 0) - keys.length);
      const approximateSizeBytes = Math.max(
        0,
        normalizedStoredSize(sessionData.approximateSizeBytes) - bytes,
      );
      const contentRevision = normalizedContentRevision(sessionData.contentRevision) + 1;
      await sessionsStore.put({
        ...sessionData,
        lastActiveAt: Date.now(),
        messageCount,
        approximateSizeBytes,
        contentRevision,
      });
      this.#messageCount = messageCount;
      this.#approximateSizeBytes = approximateSizeBytes;
      this.#contentRevision = Math.max(this.#contentRevision, contentRevision);
    }

    await tx.done;
    if (keys.length > 0) {
      await this.#deleteLoadedRangesAfterPrune();
    }
  }

  public async getBackfillMessages(params: {
    time: Time;
    topics: readonly string[];
    start?: Time;
  }): Promise<readonly MessageEvent[]> {
    if (this.#closed) {
      log.debug("Skipping getBackfillMessages - store has been closed");
      return [];
    }

    const { time, topics, start } = params;
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;

    const tx = this.#trackTransaction(db.transaction(STORE, "readonly"));
    const index = tx.store.index("bySessionTopicTime");

    const results: MessageEvent[] = [];
    for (const topic of topics) {
      const upper = IDBKeyRange.upperBound([sessionId, topic, time.sec, time.nsec]);
      let found: StoredMessageEvent | undefined;
      for await (const cursor of index.iterate(upper, "prev")) {
        const v = cursor.value;
        if (v.sessionId !== sessionId || v.topic !== topic) {
          break;
        }
        if (start != undefined && compareTime(v.receiveTime, start) < 0) {
          break;
        }
        if (!isGreaterThan(v.receiveTime, time)) {
          found = v;
          break;
        }
      }
      if (found) {
        results.push(restoreEvent(found));
      }
    }

    await tx.done;
    return results;
  }

  public async clear(): Promise<void> {
    if (this.#closed) {
      log.debug("Skipping clear - store has been closed");
      return;
    }

    const deletedMessageCount = this.#messageCount;
    await this.#cleanupSessionData(this.#currentSessionId);
    this.#markContentRemoved(deletedMessageCount);
    await this.#recordSessionCreation();
    this.#clearAppendQueue();
    this.#messageCount = 0;
    this.#approximateSizeBytes = 0;
    log.debug("cleared session: ", { sessionId: this.#currentSessionId });
  }

  public async deleteCurrentSession(): Promise<void> {
    if (this.#closed) {
      log.debug("Skipping deleteCurrentSession - store has been closed");
      return;
    }

    await this.flush();
    const deletedMessageCount = this.#messageCount;
    await this.#cleanupSessionData(this.#currentSessionId);
    this.#markContentRemoved(deletedMessageCount);
    this.#clearAppendQueue();
    this.#messageCount = 0;
    this.#approximateSizeBytes = 0;
    this.#lastPruneTime = undefined;
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public discardAndSeal(status: "pending-delete" | "abandoned"): Promise<void> {
    this.#resourceClosePromise ??= this.#discardAndSealImpl(status);
    return this.#resourceClosePromise;
  }

  async #discardAndSealImpl(status: "pending-delete" | "abandoned"): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#beginShutdown();
    this.#closing = true;
    if (this.#appendFlushTimer != undefined) {
      clearTimeout(this.#appendFlushTimer);
      this.#appendFlushTimer = undefined;
    }
    this.#clearAppendQueue();

    try {
      const shutdownResult = await this.#settleShutdownOperation(
        Promise.allSettled([
          this.#appendFlushInFlight ?? Promise.resolve(),
          this.#stopBackgroundMaintenance(),
          this.#waitForActiveTransactions(),
        ]),
        "spill session sealing",
        { reserveRemainingMs: this.#shutdownStatusReserveMs() },
      );
      if (shutdownResult.status === "rejected") {
        throw shutdownResult.reason;
      }
      const appendFailed = shutdownResult.value.some((result) => result.status === "rejected");
      const dbResult = await this.#settleShutdownOperation(
        this.#dbPromise,
        "database availability for spill session status",
      );
      if (dbResult.status === "rejected") {
        throw dbResult.reason;
      }
      const db = dbResult.value;
      if (!this.#unavailable) {
        const effectiveStatus =
          appendFailed || this.#writeFailure != undefined ? "abandoned" : status;
        const statusResult = await this.#settleShutdownOperation(
          this.#updateSessionStatus(db, effectiveStatus, { sealSession: true }),
          "spill session status update",
        );
        if (statusResult.status === "rejected") {
          throw statusResult.reason;
        }
        this.#reportMetric("session", { status: effectiveStatus });
      }
    } catch (error) {
      log.warn("Failed to seal IndexedDbMessageStore session before closing", {
        dbName: this.#dbName,
        sessionId: this.#currentSessionId,
        status,
        error,
      });
      if (!this.#unavailable) {
        try {
          const dbResult = await this.#settleShutdownOperation(
            this.#dbPromise,
            "database availability for spill abandoned status",
          );
          if (dbResult.status === "fulfilled") {
            await this.#settleShutdownOperation(
              this.#updateSessionStatus(dbResult.value, "abandoned", { sealSession: true }),
              "spill abandoned status update",
            );
          }
        } catch (fallbackError) {
          log.debug("Failed to mark IndexedDbMessageStore session abandoned", fallbackError);
        }
      }
    } finally {
      this.#closed = true;
      this.#clearAppendQueue();
      await this.#closeDatabaseConnection();
      scheduleMessageCacheJanitor(this.#kind, this.#metricSink);
    }
  }

  /** @deprecated Use discardAndSeal(). */
  public async discardAndClose(status: "pending-delete" | "abandoned"): Promise<void> {
    await this.discardAndSeal(status);
  }

  public async clearAll(): Promise<void> {
    if (this.#closed) {
      log.debug("Skipping clearAll - store has been closed");
      return;
    }

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(
      db.transaction(
        [STORE, DATATYPES_STORE, SESSIONS_STORE, TOPICS_STORE, LOADED_RANGES_STORE],
        "readwrite",
      ),
    );
    await tx.objectStore(STORE).clear();
    await tx.objectStore(DATATYPES_STORE).clear();
    await tx.objectStore(SESSIONS_STORE).clear();
    await tx.objectStore(TOPICS_STORE).clear();
    await tx.objectStore(LOADED_RANGES_STORE).clear();
    await tx.done;
    this.#clearAppendQueue();
    this.#messageCount = 0;
    this.#approximateSizeBytes = 0;
    this.#lastPruneTime = undefined;
  }

  public async clearSessionsByKind(kind: CacheSessionKind): Promise<void> {
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readonly"));
    const sessionIds: string[] = [];
    for await (const cursor of tx.store.index("byKind").iterate(kind)) {
      sessionIds.push(cursor.value.sessionId);
    }
    await tx.done;

    for (const sessionId of sessionIds) {
      await this.#cleanupSessionData(sessionId);
    }
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public close(): Promise<void> {
    this.#resourceClosePromise ??= this.#closeImpl();
    return this.#resourceClosePromise;
  }

  async #closeImpl(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#beginShutdown();
    this.#closing = true;
    const shutdownResult = await this.#settleShutdownOperation(
      Promise.allSettled([
        this.flush(),
        this.#stopBackgroundMaintenance(),
        this.#waitForActiveTransactions(),
      ]),
      "cache flush and maintenance",
      { reserveRemainingMs: this.#shutdownStatusReserveMs() },
    );
    let flushError: unknown =
      shutdownResult.status === "rejected"
        ? shutdownResult.reason
        : shutdownResult.value.find((result) => result.status === "rejected")?.reason;
    if (flushError != undefined) {
      log.warn("Error flushing pending events on close:", flushError);
    }
    this.#closed = true;
    this.#clearAppendQueue();

    try {
      const dbResult = await this.#settleShutdownOperation(
        this.#dbPromise,
        "database availability for session status",
      );
      if (dbResult.status === "fulfilled" && !this.#unavailable) {
        const status = flushError == undefined ? "closed" : "abandoned";
        const statusResult = await this.#settleShutdownOperation(
          this.#updateSessionStatus(dbResult.value, status),
          "session status update",
        );
        if (statusResult.status === "fulfilled") {
          this.#reportMetric("session", { status });
        } else if (flushError == undefined) {
          flushError = statusResult.reason;
        }
      } else if (dbResult.status === "rejected" && flushError == undefined) {
        flushError = dbResult.reason;
      }
    } catch (error) {
      log.debug("Error marking database session closed:", error);
    } finally {
      await this.#closeDatabaseConnection();
    }

    if (flushError != undefined) {
      throw toError(flushError);
    }
  }

  async #updateSessionStatus(
    db: IDB.IDBPDatabase<MessagesDB>,
    status: NonNullable<CacheSessionMetadata["status"]>,
    options: { sealSession?: boolean } = {},
  ): Promise<void> {
    const tx = this.#trackTransaction(db.transaction(SESSIONS_STORE, "readwrite"), {
      allowWhileClosing: true,
    });
    const store = tx.objectStore(SESSIONS_STORE);
    const existing = await store.get(this.#currentSessionId);
    if (existing != undefined) {
      const owners = (existing.owners ?? []).filter((owner) => owner !== this.#ownerId);
      const now = Date.now();
      if (
        existing.status === "pending-delete" ||
        (existing.status === "abandoned" && options.sealSession !== true)
      ) {
        // A discard or janitor claim is terminal. Another connection closing later must never
        // revive or downgrade it, regardless of whether a cleanup token has been attached yet.
        await store.put({ ...existing, owners, lastActiveAt: now });
      } else if (options.sealSession === true) {
        await store.put({ ...existing, status, owners, lastActiveAt: now });
      } else if (owners.length > 0) {
        // Closing one of several same-session connections only releases its lease. Remaining
        // writers keep the shared session active.
        await store.put({ ...existing, status: "active", owners, lastActiveAt: now });
      } else {
        await store.put({ ...existing, status, owners, lastActiveAt: now });
      }
    }
    await tx.done;
  }

  async #closeDatabaseConnection(): Promise<void> {
    const closeWhenAvailable = this.#dbPromise.then(
      (db) => {
        log.debug("Closing database", {
          dbName: this.#dbName,
          sessionId: this.#currentSessionId,
        });
        db.close();
      },
      (error: unknown) => {
        log.debug("Error closing database:", error);
      },
    );
    const result = await this.#settleShutdownOperation(
      closeWhenAvailable,
      "database connection close",
    );
    if (result.status === "rejected" && !(result.reason instanceof ShutdownTimeoutError)) {
      log.debug("Failed to close database connection:", result.reason);
    }
  }

  public async stats(): Promise<{
    count: number;
    earliest?: Time;
    latest?: Time;
    approximateSizeBytes?: number;
  }> {
    if (this.#closed) {
      log.debug("Skipping stats - store has been closed");
      return { count: 0 };
    }

    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;

    const tx = this.#trackTransaction(db.transaction(STORE, "readonly"));
    const index = tx.store.index("bySessionTime");
    const range = IDBKeyRange.bound(
      [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    );

    let earliest: Time | undefined;
    let latest: Time | undefined;

    const firstCursor = await index.openCursor(range);
    if (firstCursor != undefined) {
      earliest = firstCursor.value.receiveTime;
    }

    const lastCursor = await index.openCursor(range, "prev");
    if (lastCursor != undefined) {
      latest = lastCursor.value.receiveTime;
    }

    await tx.done;

    return {
      count: this.#messageCount,
      earliest,
      latest,
      approximateSizeBytes: this.#approximateSizeBytes,
    };
  }

  public async getWindowStats(): Promise<{
    retentionWindowMs: number;
    messageCount: number;
    windowUtilization: number;
    oldestMessage?: Time;
    newestMessage?: Time;
    cacheSize: {
      approximateSizeBytes: number;
      maxCacheSize: number;
      sizeUtilization: number;
    };
    cacheEfficiency: {
      pruneIntervalMs: number;
      lastPruneTime?: number;
      timeSinceLastPrune?: number;
    };
  }> {
    const stats = await this.stats();

    let windowUtilization = 0;
    if (stats.earliest && stats.latest) {
      const dataSpanMs =
        (stats.latest.sec - stats.earliest.sec) * 1000 +
        (stats.latest.nsec - stats.earliest.nsec) / 1e6;
      windowUtilization = Math.min(100, (dataSpanMs / this.#retentionWindowMs) * 100);
    }

    const now = Date.now();
    const approximateSizeBytes = stats.approximateSizeBytes ?? 0;
    const sizeUtilization =
      this.#maxCacheSize > 0
        ? (approximateSizeBytes / this.#maxCacheSize) * 100
        : approximateSizeBytes > 0
          ? 100
          : 0;

    return {
      retentionWindowMs: this.#retentionWindowMs,
      messageCount: stats.count,
      windowUtilization,
      oldestMessage: stats.earliest,
      newestMessage: stats.latest,
      cacheSize: {
        approximateSizeBytes,
        maxCacheSize: this.#maxCacheSize,
        sizeUtilization: Math.min(100, sizeUtilization),
      },
      cacheEfficiency: {
        pruneIntervalMs: this.#pruneIntervalMs,
        lastPruneTime: this.#lastPruneTime,
        timeSinceLastPrune:
          this.#lastPruneTime != undefined ? now - this.#lastPruneTime : undefined,
      },
    };
  }

  public async forcePrune(): Promise<{
    prunedCount: number;
    newCount: number;
    initialStorageBytes: number;
    finalStorageBytes: number;
  }> {
    const stats = await this.stats();
    const initialStorage = stats.approximateSizeBytes ?? 0;
    const now = Date.now();
    const cutoffDate = new Date(now - this.#retentionWindowMs);
    const cutoff: Time = {
      sec: Math.floor(cutoffDate.getTime() / 1000),
      nsec: (cutoffDate.getTime() % 1000) * 1e6,
    };

    let totalPrunedCount = 0;

    try {
      const timePruneResult = await this.#pruneBeforeTime(this.#currentSessionId, cutoff);
      totalPrunedCount += timePruneResult.count;

      const storageAfterTimePrune = this.#approximateSizeBytes;
      if (storageAfterTimePrune > this.#maxCacheSize) {
        const sizePruneResult = await this.#pruneOldestUntilSize(
          this.#currentSessionId,
          this.#sessionPruneTargetSize(),
        );
        totalPrunedCount += sizePruneResult.count;
      }
    } catch (error) {
      await this.#failAfterPruneError(error);
    }

    this.#lastPruneTime = now;
    if (totalPrunedCount > 0) {
      await this.#deleteLoadedRangesAfterPrune();
    }

    log.info(
      `Force pruned ${totalPrunedCount} messages, approximate storage: ${Math.round(
        initialStorage / 1024 / 1024,
      )}MB -> ${Math.round(this.#approximateSizeBytes / 1024 / 1024)}MB`,
    );

    return {
      prunedCount: totalPrunedCount,
      newCount: this.#messageCount,
      initialStorageBytes: initialStorage,
      finalStorageBytes: this.#approximateSizeBytes,
    };
  }

  public setPruneInterval(intervalMs: number): void {
    this.#pruneIntervalMs = Math.max(1000, intervalMs);
  }

  public async storeDatatypes(datatypes: RosDatatypes): Promise<void> {
    await this.#initPromise;
    this.#assertWritable("store datatype metadata");

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(
      db.transaction([DATATYPES_STORE, SESSIONS_STORE], "readwrite"),
    );
    const sessionStore = tx.objectStore(SESSIONS_STORE);
    const session = await sessionStore.get(this.#currentSessionId);
    if (session?.status !== "active") {
      await tx.done;
      throw new Error("IndexedDbMessageStore session is no longer active");
    }
    const store = tx.objectStore(DATATYPES_STORE);

    const datatypesObj: Record<string, OptionalMessageDefinition> = {};
    for (const [key, value] of datatypes) {
      datatypesObj[key] = value;
    }

    await store.put({
      sessionId: this.#currentSessionId,
      datatypes: datatypesObj,
      timestamp: Date.now(),
    });
    await sessionStore.put({ ...session, lastActiveAt: Date.now() });
    await tx.done;
  }

  public async getDatatypes(): Promise<RosDatatypes | undefined> {
    if (this.#closed) {
      log.debug("Skipping getDatatypes - store has been closed");
      return undefined;
    }

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(DATATYPES_STORE, "readonly"));
    const result = await tx.store.get(this.#currentSessionId);
    await tx.done;

    if (!result) {
      return undefined;
    }

    const datatypes = new Map<string, OptionalMessageDefinition>();
    for (const [key, value] of Object.entries(result.datatypes)) {
      datatypes.set(key, value);
    }

    return datatypes;
  }

  public async storeTopics(
    topics: readonly TopicWithDecodingInfo[],
    topicStats?: Map<string, TopicStats>,
  ): Promise<void> {
    await this.#initPromise;
    this.#assertWritable("store topic metadata");

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction([TOPICS_STORE, SESSIONS_STORE], "readwrite"));
    const store = tx.objectStore(TOPICS_STORE);
    const sessionStore = tx.objectStore(SESSIONS_STORE);
    const session = await sessionStore.get(this.#currentSessionId);
    if (session?.status !== "active") {
      await tx.done;
      throw new Error("IndexedDbMessageStore session is no longer active");
    }
    const now = Date.now();
    const topicNames = new Set(topics.map((topic) => topic.name));

    for await (const cursor of store.index("bySession").iterate(this.#currentSessionId)) {
      if (!topicNames.has(cursor.value.name)) {
        await cursor.delete();
      }
    }

    for (const topic of topics) {
      await store.put({
        sessionId: this.#currentSessionId,
        name: topic.name,
        schemaName: topic.schemaName,
        messageEncoding: topic.messageEncoding,
        schemaEncoding: topic.schemaEncoding,
        schemaData: topic.schemaData,
        topicStats: topicStats?.get(topic.name),
        updatedAt: now,
      });
    }

    await sessionStore.put({ ...session, lastActiveAt: now });
    await tx.done;
  }

  public async getTopics(): Promise<readonly TopicMetadata[]> {
    if (this.#closed) {
      return [];
    }

    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(db.transaction(TOPICS_STORE, "readonly"));
    const out: TopicMetadata[] = [];
    for await (const cursor of tx.store.index("bySession").iterate(this.#currentSessionId)) {
      const value = cursor.value;
      out.push({
        name: value.name,
        schemaName: value.schemaName,
        messageEncoding: value.messageEncoding,
        schemaEncoding: value.schemaEncoding,
        schemaData: value.schemaData,
        topicStats: value.topicStats,
      });
    }
    await tx.done;
    return out;
  }

  public async putLoadedRange(
    range: Omit<LoadedRange, "id" | "updatedAt">,
    expectedContentRevision?: number,
  ): Promise<boolean> {
    if (range.sessionId !== this.#currentSessionId) {
      throw new Error("Loaded range sessionId must match the current cache session");
    }
    await this.#initPromise;
    this.#assertWritable("store a loaded range");
    if (expectedContentRevision != undefined && expectedContentRevision !== this.#contentRevision) {
      return false;
    }
    const db = await this.#dbPromise;
    this.#assertWritable("store a loaded range");
    if (expectedContentRevision != undefined && expectedContentRevision !== this.#contentRevision) {
      return false;
    }
    // Including the message store serializes this coverage update with pruning transactions. A
    // prune that wins the race will subsequently clear the range, while a later prune waits and
    // clears it after this transaction commits.
    const tx = this.#trackTransaction(
      db.transaction([STORE, LOADED_RANGES_STORE, SESSIONS_STORE], "readwrite"),
    );
    const store = tx.objectStore(LOADED_RANGES_STORE);
    const sessionsStore = tx.objectStore(SESSIONS_STORE);
    const existingSession = await sessionsStore.get(this.#currentSessionId);
    if (existingSession == undefined || existingSession.status !== "active") {
      await tx.done;
      return false;
    }
    const persistedContentRevision = normalizedContentRevision(existingSession.contentRevision);
    this.#contentRevision = Math.max(this.#contentRevision, persistedContentRevision);
    if (
      expectedContentRevision != undefined &&
      expectedContentRevision !== persistedContentRevision
    ) {
      await tx.done;
      return false;
    }
    let startNs = toNanoSec(range.start);
    let endNs = toNanoSec(range.end);
    const obsoleteKeys = new Set<string>();
    const rangeIndex = store.index("bySessionFingerprintStart");

    // Find only the immediate predecessor. Existing ranges are normalized, so no earlier range can
    // overlap unless this one does. This avoids rescanning every historical seek range on insert.
    const predecessor = await rangeIndex.openCursor(
      IDBKeyRange.upperBound([
        range.sessionId,
        range.topicFingerprint,
        range.start.sec,
        range.start.nsec,
      ]),
      "prev",
    );
    if (
      predecessor != undefined &&
      predecessor.value.sessionId === range.sessionId &&
      predecessor.value.topicFingerprint === range.topicFingerprint
    ) {
      if (
        normalizedContentRevision(predecessor.value.contentRevision) !== persistedContentRevision
      ) {
        obsoleteKeys.add(predecessor.primaryKey);
      } else {
        const predecessorStartNs = toNanoSec(predecessor.value.start);
        const predecessorEndNs = toNanoSec(predecessor.value.end);
        if (predecessorEndNs + 1n >= startNs) {
          startNs = startNs < predecessorStartNs ? startNs : predecessorStartNs;
          endNs = endNs > predecessorEndNs ? endNs : predecessorEndNs;
          obsoleteKeys.add(predecessor.primaryKey);
        }
      }
    }

    const forwardRange = IDBKeyRange.bound(
      [range.sessionId, range.topicFingerprint, range.start.sec, range.start.nsec],
      [range.sessionId, range.topicFingerprint, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    );
    for await (const cursor of rangeIndex.iterate(forwardRange)) {
      if (obsoleteKeys.has(cursor.primaryKey)) {
        continue;
      }
      const value = cursor.value;
      if (normalizedContentRevision(value.contentRevision) !== persistedContentRevision) {
        obsoleteKeys.add(cursor.primaryKey);
        continue;
      }
      const valueStartNs = toNanoSec(value.start);
      const valueEndNs = toNanoSec(value.end);
      if (valueStartNs > endNs + 1n) {
        break;
      }
      if (valueEndNs + 1n < startNs) {
        continue;
      }
      startNs = startNs < valueStartNs ? startNs : valueStartNs;
      endNs = endNs > valueEndNs ? endNs : valueEndNs;
      obsoleteKeys.add(cursor.primaryKey);
    }

    for (const key of obsoleteKeys) {
      await store.delete(key);
    }

    const mergedRange = {
      ...range,
      start: fromNanoSec(startNs),
      end: fromNanoSec(endNs),
    };
    const id = `${mergedRange.sessionId}:${mergedRange.topicFingerprint}:${mergedRange.start.sec}:${mergedRange.start.nsec}:${mergedRange.end.sec}:${mergedRange.end.nsec}`;
    const now = Date.now();
    await store.put({
      ...mergedRange,
      id,
      updatedAt: now,
      contentRevision: persistedContentRevision,
    });
    await sessionsStore.put({
      ...existingSession,
      lastActiveAt: now,
      contentRevision: persistedContentRevision,
    });
    await tx.done;
    if (expectedContentRevision != undefined && expectedContentRevision !== this.#contentRevision) {
      await this.#deleteLoadedRangesAfterPrune();
      return false;
    }
    return true;
  }

  public async getLoadedRanges(topicFingerprint: string): Promise<readonly LoadedRange[]> {
    if (this.#closed) {
      return [];
    }
    const db = await this.#dbPromise;
    const tx = this.#trackTransaction(
      db.transaction([LOADED_RANGES_STORE, SESSIONS_STORE], "readonly"),
    );
    const session = await tx.objectStore(SESSIONS_STORE).get(this.#currentSessionId);
    if (session == undefined || session.status !== "active") {
      await tx.done;
      return [];
    }
    const persistedContentRevision = normalizedContentRevision(session.contentRevision);
    this.#contentRevision = Math.max(this.#contentRevision, persistedContentRevision);
    const keyRange = IDBKeyRange.bound(
      [this.#currentSessionId, topicFingerprint, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      [this.#currentSessionId, topicFingerprint, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    );
    const out: LoadedRange[] = [];
    for await (const cursor of tx
      .objectStore(LOADED_RANGES_STORE)
      .index("bySessionFingerprintStart")
      .iterate(keyRange)) {
      if (normalizedContentRevision(cursor.value.contentRevision) === persistedContentRevision) {
        out.push(cursor.value);
      }
    }
    await tx.done;
    return out;
  }

  public async hasLoadedRange(params: {
    topicFingerprint: string;
    start: Time;
    end: Time;
  }): Promise<boolean> {
    const ranges = await this.getLoadedRanges(params.topicFingerprint);
    return isLoadedRangeCovering(ranges, params.start, params.end);
  }

  public async deleteLoadedRanges(topicFingerprint?: string): Promise<void> {
    if (this.#closed) {
      return;
    }

    const db = await this.#dbPromise;
    for (;;) {
      const tx = this.#trackTransaction(db.transaction(LOADED_RANGES_STORE, "readwrite"));
      const keys: string[] = [];
      let estimatedBytes = 0;
      const cursorIterable =
        topicFingerprint == undefined
          ? tx.store.index("bySession").iterate(this.#currentSessionId)
          : tx.store
              .index("bySessionFingerprintStart")
              .iterate(
                IDBKeyRange.bound(
                  [
                    this.#currentSessionId,
                    topicFingerprint,
                    Number.MIN_SAFE_INTEGER,
                    Number.MIN_SAFE_INTEGER,
                  ],
                  [
                    this.#currentSessionId,
                    topicFingerprint,
                    Number.MAX_SAFE_INTEGER,
                    Number.MAX_SAFE_INTEGER,
                  ],
                ),
              );
      for await (const cursor of cursorIterable) {
        const rangeBytes = 512 + cursor.value.topicFingerprint.length * 2;
        if (
          keys.length > 0 &&
          (keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
            estimatedBytes + rangeBytes > CLEANUP_BATCH_MAX_BYTES)
        ) {
          break;
        }
        keys.push(cursor.primaryKey);
        estimatedBytes += rangeBytes;
        if (
          keys.length >= CLEANUP_BATCH_MAX_MESSAGES ||
          estimatedBytes >= CLEANUP_BATCH_MAX_BYTES
        ) {
          break;
        }
      }

      for (const key of keys) {
        await tx.store.delete(key);
      }
      await tx.done;
      if (keys.length === 0) {
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
}

const scheduledJanitors = new Map<CacheSessionKind, { token: symbol; dueAt: number }>();
const runningJanitors = new Set<CacheSessionKind>();
const queuedJanitorReruns = new Set<CacheSessionKind>();
const queuedJanitorMetricSinks = new Map<CacheSessionKind, MessageCacheMetricSink>();

function scheduleJanitorTimer(callback: () => void, delayMs: number): void {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    window.setTimeout(callback, delayMs);
  } else {
    setTimeout(callback, delayMs);
  }
}

function scheduleMessageCacheJanitor(
  kind: CacheSessionKind,
  metricSink?: MessageCacheMetricSink,
  delayMs = 0,
): void {
  const { requestIdleCallback } = getIdleSchedulingGlobal();
  // Node tests and workers have no layout lifecycle to protect. The browser main thread uses a
  // timer fallback when requestIdleCallback is unavailable.
  const canUseTimerFallback =
    typeof window !== "undefined" && typeof window.setTimeout === "function";
  if (requestIdleCallback == undefined && !canUseTimerFallback) {
    return;
  }

  if (runningJanitors.has(kind)) {
    queuedJanitorReruns.add(kind);
    if (metricSink != undefined) {
      queuedJanitorMetricSinks.set(kind, metricSink);
    }
    return;
  }

  const dueAt = Date.now() + Math.max(0, delayMs);
  const existing = scheduledJanitors.get(kind);
  if (existing != undefined && existing.dueAt <= dueAt) {
    return;
  }

  const token = Symbol(kind);
  scheduledJanitors.set(kind, { token, dueAt });

  const run = () => {
    if (scheduledJanitors.get(kind)?.token !== token) {
      return;
    }
    // Allow a discard that happens during this pass to queue the next pass immediately.
    scheduledJanitors.delete(kind);
    runningJanitors.add(kind);
    void (async () => {
      let janitor: IndexedDbMessageStore | undefined;
      let retryDelayMs: number | undefined;
      try {
        janitor = new IndexedDbMessageStore({ kind, maintenanceOnly: true, metricSink });
        await janitor.init();
        retryDelayMs = await janitor.runMaintenance();
      } catch (error) {
        log.warn("Idle IndexedDbMessageStore janitor failed", { kind, error });
      } finally {
        try {
          await janitor?.close();
        } catch (error) {
          log.debug("Failed to close idle IndexedDbMessageStore janitor", { kind, error });
        }
        runningJanitors.delete(kind);
        if (queuedJanitorReruns.delete(kind)) {
          const queuedMetricSink = queuedJanitorMetricSinks.get(kind) ?? metricSink;
          queuedJanitorMetricSinks.delete(kind);
          scheduleMessageCacheJanitor(kind, queuedMetricSink);
        } else if (retryDelayMs != undefined) {
          scheduleMessageCacheJanitor(kind, metricSink, retryDelayMs);
        }
      }
    })();
  };

  const requestRunWhenIdle = () => {
    if (scheduledJanitors.get(kind)?.token !== token) {
      return;
    }
    const idleScheduler = getIdleSchedulingGlobal().requestIdleCallback;
    if (idleScheduler != undefined) {
      idleScheduler.call(globalThis, run, { timeout: 5_000 });
    } else {
      scheduleJanitorTimer(run, 5_000);
    }
  };

  if (delayMs > 0) {
    scheduleJanitorTimer(requestRunWhenIdle, delayMs);
  } else {
    requestRunWhenIdle();
  }
}

/**
 * Schedule maintenance for both physical cache databases after the application layout commits.
 * This intentionally does not depend on the playback writer kill switch: a disabled writer must
 * not strand sessions left behind by a previous rollout or browser crash.
 */
export function scheduleMessageCacheMaintenance(metricSink?: MessageCacheMetricSink): void {
  scheduleMessageCacheJanitor("playback-spill", metricSink);
  scheduleMessageCacheJanitor("realtime-viz", metricSink);
}

export async function clearIndexedDbMessageStoreDatabase(): Promise<void> {
  await Promise.all([
    IDB.deleteDB(REALTIME_MESSAGE_CACHE_DB_NAME),
    IDB.deleteDB(PLAYBACK_MESSAGE_CACHE_DB_NAME),
    IDB.deleteDB(LEGACY_MESSAGE_CACHE_DB_NAME),
  ]);
}

export function scheduleLegacyMessageCacheDatabaseDeletion(
  options: {
    onBlocked?: () => void;
  } = {},
): () => void {
  let cancelled = false;
  const deleteLegacyDatabase = () => {
    if (cancelled) {
      return;
    }
    void IDB.deleteDB(LEGACY_MESSAGE_CACHE_DB_NAME, {
      blocked(currentVersion) {
        log.warn("Legacy message cache deletion is blocked by another tab", {
          dbName: LEGACY_MESSAGE_CACHE_DB_NAME,
          currentVersion,
        });
        options.onBlocked?.();
      },
    }).then(
      () => {
        log.info("Legacy message cache database deleted", {
          dbName: LEGACY_MESSAGE_CACHE_DB_NAME,
        });
      },
      (error: unknown) => {
        log.warn("Legacy message cache database deletion failed", {
          dbName: LEGACY_MESSAGE_CACHE_DB_NAME,
          error,
        });
      },
    );
  };

  const { requestIdleCallback, cancelIdleCallback } = getIdleSchedulingGlobal();
  if (requestIdleCallback != undefined && cancelIdleCallback != undefined) {
    const idleCallbackId = requestIdleCallback.call(globalThis, deleteLegacyDatabase, {
      timeout: 10_000,
    });
    return () => {
      cancelled = true;
      cancelIdleCallback.call(globalThis, idleCallbackId);
    };
  }

  const timeoutId = setTimeout(deleteLegacyDatabase, 1_000);
  return () => {
    cancelled = true;
    clearTimeout(timeoutId);
  };
}
