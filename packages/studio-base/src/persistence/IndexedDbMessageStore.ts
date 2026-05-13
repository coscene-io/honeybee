// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import Log from "@foxglove/log";
import { isGreaterThan, Time, fromMillis, subtract } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import type { TopicStats } from "@foxglove/studio-base/players/types";
import { OptionalMessageDefinition, RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import type { PersistentMessageCache } from "./PersistentMessageCache";

const log = Log.getLogger(__filename);

const DB_NAME = "studio-realtime-cache";
const DB_VERSION = 2;
const STORE = "messages";
const DATATYPES_STORE = "datatypes";
const SESSIONS_STORE = "sessions";
const TOPICS_STORE = "topics";
const LOADED_RANGES_STORE = "loadedRanges";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_OPEN_TIMEOUT_MS = 5000;

type StoreName =
  | typeof STORE
  | typeof DATATYPES_STORE
  | typeof SESSIONS_STORE
  | typeof TOPICS_STORE
  | typeof LOADED_RANGES_STORE;

export type CacheSessionKind = "realtime-viz" | "playback-spill";

export type CacheSessionMetadata = {
  sessionId: string;
  kind: CacheSessionKind;
  createdAt: number;
  lastActiveAt: number;
  sourceId?: string;
  sourceKey?: string;
  topicFingerprint?: string;
  retentionWindowMs?: number;
  maxBytes?: number;
  status?: "active" | "closed" | "abandoned" | "pending-delete";
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
};

type StoredMessageEvent = Omit<MessageEvent, "originalMessageEvent"> & {
  sessionId: string;
  seq: number;
};

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

function sanitizeEvent(sessionId: string, seq: number, event: MessageEvent): StoredMessageEvent {
  const { originalMessageEvent: _drop, ...rest } = event;
  return { ...rest, sessionId, seq };
}

function eventSize(event: MessageEvent): number {
  return Math.max(0, event.sizeInBytes);
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
  /** Max cache size in bytes (default: 25GB) */
  maxCacheSize?: number;
  /** Session kind to isolate realtime history from future playback spill cache. */
  kind?: CacheSessionKind;
  sourceId?: string;
  sourceKey?: string;
  topicFingerprint?: string;
  /** Maximum queued messages before oldest queued writes are dropped. */
  maxQueuedMessages?: number;
  /** Maximum messages written per IndexedDB transaction. */
  appendBatchMaxSize?: number;
  /** Timeout for blocked IndexedDB opens so realtime viz can degrade instead of hanging. */
  openTimeoutMs?: number;
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

function deleteStoreIfPresent(db: IDB.IDBPDatabase<MessagesDB>, storeName: StoreName): void {
  if (db.objectStoreNames.contains(storeName)) {
    db.deleteObjectStore(storeName);
  }
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
  #retentionWindowMs: number;
  #maxCacheSize: number;
  #kind: CacheSessionKind;
  #sourceId?: string;
  #sourceKey?: string;
  #topicFingerprint?: string;
  #currentSessionId: string;
  #initPromise: Promise<void>;
  #closing = false;
  #closed = false;
  #lastPruneTime?: number;
  #pruneIntervalMs: number = 1 * 1000;
  #messageCount = 0;
  #approximateSizeBytes = 0;
  #nextSeq = 0;
  #appendQueue: MessageEvent[] = [];
  #appendFlushTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  #appendFlushInFlight: Promise<void> | undefined = undefined;

  #appendBatchMaxSize = 1000;
  #appendBatchMaxDelayMs = 200;
  #maxQueuedMessages: number;

  public constructor(options: IndexedDbMessageStoreOptions = {}) {
    const {
      retentionWindowMs = 30 * 1000,
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      maxCacheSize = 25 * 1024 * 1024 * 1024,
      kind = "realtime-viz",
      sourceId,
      sourceKey,
      topicFingerprint,
      maxQueuedMessages = 50_000,
      appendBatchMaxSize = 1000,
      openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
    } = options;

    this.#retentionWindowMs = retentionWindowMs;
    this.#maxCacheSize = maxCacheSize;
    this.#kind = kind;
    this.#sourceId = sourceId;
    this.#sourceKey = sourceKey;
    this.#topicFingerprint = topicFingerprint;
    this.#currentSessionId = sessionId;
    this.#maxQueuedMessages = maxQueuedMessages;
    this.#appendBatchMaxSize = appendBatchMaxSize;

    const rawDbPromise = IDB.openDB<MessagesDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion > 0 && oldVersion < 2) {
          deleteStoreIfPresent(db, STORE);
          deleteStoreIfPresent(db, DATATYPES_STORE);
          deleteStoreIfPresent(db, SESSIONS_STORE);
        }
        ensureBaseStores(db);
        if (!db.objectStoreNames.contains(TOPICS_STORE)) {
          createTopicsStore(db);
        }
        if (!db.objectStoreNames.contains(LOADED_RANGES_STORE)) {
          createLoadedRangesStore(db);
        }
        void transaction.done.then(() => {
          log.debug("IndexedDbMessageStore schema upgrade complete", { oldVersion });
        });
      },
      blocked() {
        log.warn(
          "IndexedDbMessageStore initialization blocked by another open database connection",
        );
      },
      blocking() {
        log.warn("IndexedDbMessageStore is blocking a newer database version");
      },
      terminated() {
        log.warn("IndexedDbMessageStore connection terminated unexpectedly");
      },
    });
    this.#dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error("Timed out opening IndexedDbMessageStore"));
      }, openTimeoutMs);

      void rawDbPromise.then(
        (db) => {
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(db);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

    this.#initPromise = this.#initialize();
    void this.#initPromise.catch(() => undefined);
  }

  async #initialize(): Promise<void> {
    try {
      await this.#dbPromise;
      if (this.#closed) {
        log.debug("Skipping IndexedDbMessageStore initialization because store is already closed");
        return;
      }
      await this.#recordSessionCreation();
      await this.#loadExistingMessageStats();
      log.info(`IndexedDbMessageStore initialized with session: ${this.#currentSessionId}`);
    } catch (error) {
      log.error("Failed to initialize IndexedDbMessageStore:", error);
      throw toError(error);
    }
  }

  async #loadExistingMessageStats(): Promise<void> {
    try {
      if (this.#closed) {
        return;
      }
      const db = await this.#dbPromise;
      const tx = db.transaction([STORE, SESSIONS_STORE], "readonly");
      const messageIndex = tx.objectStore(STORE).index("bySession");
      const sessionMetadata = await tx.objectStore(SESSIONS_STORE).get(this.#currentSessionId);
      const count =
        sessionMetadata?.messageCount ?? (await messageIndex.count(this.#currentSessionId));
      const approximateSizeBytes = sessionMetadata?.approximateSizeBytes ?? 0;
      await tx.done;

      this.#messageCount = count;
      this.#approximateSizeBytes = approximateSizeBytes;
      log.debug(`Loaded existing message stats: ${count} messages`);

      if (sessionMetadata?.messageCount == undefined) {
        await this.#updateSessionMetadata({ messageCount: count, approximateSizeBytes });
      }
    } catch (error) {
      log.debug("Failed to load existing message stats:", error);
      throw error;
    }
  }

  async #recordSessionCreation(): Promise<void> {
    try {
      if (this.#closed) {
        return;
      }
      const db = await this.#dbPromise;
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);

      const now = Date.now();
      const existing = await store.get(this.#currentSessionId);
      const metadata: CacheSessionMetadata = {
        sessionId: this.#currentSessionId,
        kind: existing?.kind ?? this.#kind,
        createdAt: existing?.createdAt ?? now,
        lastActiveAt: now,
        sourceId: this.#sourceId ?? existing?.sourceId,
        sourceKey: this.#sourceKey ?? existing?.sourceKey,
        topicFingerprint: this.#topicFingerprint ?? existing?.topicFingerprint,
        retentionWindowMs: this.#retentionWindowMs,
        maxBytes: this.#maxCacheSize,
        status: "active",
        nextSeq: Math.max(existing?.nextSeq ?? 0, 0),
        approximateSizeBytes: existing?.approximateSizeBytes ?? 0,
        messageCount: existing?.messageCount,
      };

      this.#nextSeq = metadata.nextSeq;
      this.#approximateSizeBytes = metadata.approximateSizeBytes;
      this.#messageCount = metadata.messageCount ?? 0;

      await store.put(metadata);
      await tx.done;
      log.debug(`Recorded session metadata: ${this.#currentSessionId}`);
    } catch (error) {
      log.error("Failed to record session metadata:", error);
      throw error;
    }
  }

  public async cleanupOldSessions(kind: CacheSessionKind = this.#kind): Promise<void> {
    const cutoffTime = Date.now() - THREE_DAYS_MS;

    try {
      const db = await this.#dbPromise;
      const sessionsTx = db.transaction(SESSIONS_STORE, "readonly");
      const sessionsStore = sessionsTx.objectStore(SESSIONS_STORE);
      const oldSessions: string[] = [];

      for await (const cursor of sessionsStore
        .index("byKindLastActive")
        .iterate(IDBKeyRange.bound([kind, Number.MIN_SAFE_INTEGER], [kind, cutoffTime]))) {
        oldSessions.push(cursor.value.sessionId);
      }
      await sessionsTx.done;

      if (oldSessions.length === 0) {
        log.debug("No old sessions to clean up");
        return;
      }

      log.info(`Cleaning up ${oldSessions.length} ${kind} sessions inactive for more than 3 days`);
      for (const sessionId of oldSessions) {
        await this.#cleanupSessionData(sessionId);
      }
    } catch (error) {
      log.error("Failed to cleanup old sessions:", error);
    }
  }

  async #cleanupSessionData(sessionId: string): Promise<void> {
    try {
      const db = await this.#dbPromise;
      const tx = db.transaction(
        [STORE, DATATYPES_STORE, SESSIONS_STORE, TOPICS_STORE, LOADED_RANGES_STORE],
        "readwrite",
      );

      await tx
        .objectStore(STORE)
        .delete(
          IDBKeyRange.bound(
            [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
            [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
          ),
        );
      await tx.objectStore(DATATYPES_STORE).delete(sessionId);
      await tx.objectStore(SESSIONS_STORE).delete(sessionId);

      const topicsStore = tx.objectStore(TOPICS_STORE);
      for (const key of await topicsStore.index("bySession").getAllKeys(sessionId)) {
        await topicsStore.delete(key);
      }

      const loadedRangesStore = tx.objectStore(LOADED_RANGES_STORE);
      for (const key of await loadedRangesStore.index("bySession").getAllKeys(sessionId)) {
        await loadedRangesStore.delete(key);
      }

      await tx.done;
      if (sessionId === this.#currentSessionId) {
        this.#messageCount = 0;
        this.#approximateSizeBytes = 0;
        this.#nextSeq = 0;
      }
      log.debug(`Cleaned up all data for session: ${sessionId}`);
    } catch (error) {
      log.error(`Failed to cleanup session data for ${sessionId}:`, error);
      throw error;
    }
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

  public setMaxCacheSize(sizeBytes: number): void {
    this.#maxCacheSize = sizeBytes;
    void this.#updateSessionMetadata({ maxBytes: sizeBytes }).catch((error: unknown) => {
      log.debug("Failed to update maxBytes metadata:", error);
    });
  }

  public async getSessionMetadata(): Promise<CacheSessionMetadata | undefined> {
    if (this.#closed) {
      return undefined;
    }
    const db = await this.#dbPromise;
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const result = await tx.store.get(this.#currentSessionId);
    await tx.done;
    return result;
  }

  async #updateSessionMetadata(
    updates: Partial<Omit<CacheSessionMetadata, "sessionId" | "createdAt">>,
  ): Promise<void> {
    if (this.#closed) {
      return;
    }
    const db = await this.#dbPromise;
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
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

  public async append(events: readonly MessageEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    if (this.#closing || this.#closed) {
      log.debug("Skipping append - store is closing or closed");
      return;
    }

    this.#appendQueue.push(...events);
    const overflowCount = this.#appendQueue.length - this.#maxQueuedMessages;
    if (overflowCount > 0) {
      this.#appendQueue.splice(0, overflowCount);
      log.warn(
        `IndexedDbMessageStore append queue exceeded ${
          this.#maxQueuedMessages
        }; dropped ${overflowCount} oldest queued messages`,
      );
    }

    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#appendFlushTimer != undefined || this.#appendFlushInFlight != undefined) {
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
            log.warn("Failed to flush queued IndexedDB messages:", error);
            this.#appendFlushInFlight = undefined;
          },
        );
      },
      this.#appendQueue.length >= this.#appendBatchMaxSize ? 0 : this.#appendBatchMaxDelayMs,
    );
  }

  public async flush(): Promise<void> {
    if (this.#appendFlushTimer != undefined) {
      clearTimeout(this.#appendFlushTimer);
      this.#appendFlushTimer = undefined;
    }

    while (this.#appendQueue.length > 0 || this.#appendFlushInFlight != undefined) {
      if (this.#appendFlushInFlight != undefined) {
        await this.#appendFlushInFlight;
        continue;
      }
      this.#appendFlushInFlight = this.#flushQueuedAppends();
      try {
        await this.#appendFlushInFlight;
      } finally {
        this.#appendFlushInFlight = undefined;
      }
    }
  }

  async #flushQueuedAppends(): Promise<void> {
    const batch = this.#appendQueue.splice(0, this.#appendBatchMaxSize);
    if (batch.length === 0) {
      return;
    }

    const db = await this.#dbPromise;
    if (this.#closed) {
      this.#appendQueue.unshift(...batch);
      return;
    }

    const tx = db.transaction([STORE, SESSIONS_STORE], "readwrite");
    const store = tx.objectStore(STORE);
    const sessionsStore = tx.objectStore(SESSIONS_STORE);

    const sessionId = this.#currentSessionId;
    let latestTime: Time | undefined;
    let approximateSizeBytesAdded = 0;
    let seq = this.#nextSeq;

    for (const ev of batch) {
      latestTime =
        latestTime == undefined || isGreaterThan(ev.receiveTime, latestTime)
          ? ev.receiveTime
          : latestTime;
      approximateSizeBytesAdded += eventSize(ev);
      await store.put(sanitizeEvent(sessionId, seq++, ev));
    }

    const now = Date.now();
    const sessionData = await sessionsStore.get(sessionId);
    if (sessionData != undefined) {
      await sessionsStore.put({
        ...sessionData,
        lastActiveAt: now,
        nextSeq: seq,
        messageCount: Math.max(0, (sessionData.messageCount ?? 0) + batch.length),
        approximateSizeBytes: Math.max(
          0,
          sessionData.approximateSizeBytes + approximateSizeBytesAdded,
        ),
      });
    }

    await tx.done;

    this.#nextSeq = seq;
    this.#messageCount += batch.length;
    this.#approximateSizeBytes += approximateSizeBytesAdded;

    await this.#maybePrune(latestTime);
  }

  async #maybePrune(latestTime: Time | undefined): Promise<void> {
    if (latestTime == undefined) {
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
      let totalPrunedBytes = 0;

      const retentionWindowMsTime = fromMillis(this.#retentionWindowMs);
      const cutoff = subtract(latestTime, retentionWindowMsTime);
      const timePruneResult = await this.#pruneBeforeTime(this.#currentSessionId, cutoff);
      totalPrunedCount += timePruneResult.count;
      totalPrunedBytes += timePruneResult.bytes;

      const approximateAfterTimePrune = Math.max(0, this.#approximateSizeBytes - totalPrunedBytes);
      if (approximateAfterTimePrune > this.#maxCacheSize) {
        const sizePruneResult = await this.#pruneOldestUntilSize(
          this.#currentSessionId,
          this.#maxCacheSize * 0.9,
          approximateAfterTimePrune,
        );
        totalPrunedCount += sizePruneResult.count;
        totalPrunedBytes += sizePruneResult.bytes;
      }

      this.#messageCount = Math.max(0, this.#messageCount - totalPrunedCount);
      this.#approximateSizeBytes = Math.max(0, this.#approximateSizeBytes - totalPrunedBytes);
      this.#lastPruneTime = now;

      if (totalPrunedCount > 0) {
        await this.#updateSessionMetadata({
          approximateSizeBytes: this.#approximateSizeBytes,
          messageCount: this.#messageCount,
        });
        log.debug(
          `Pruned ${totalPrunedCount} messages, approximate session size: ${Math.round(
            this.#approximateSizeBytes / 1024 / 1024,
          )}MB (limit: ${Math.round(this.#maxCacheSize / 1024 / 1024)}MB)`,
        );
      }
    } catch (err) {
      log.debug("append: pruning failed", err);
    }
  }

  async #pruneBeforeTime(
    sessionId: string,
    cutoff: Time,
  ): Promise<{ count: number; bytes: number }> {
    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.store.index("bySessionTime");
    const range = IDBKeyRange.bound(
      [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      [sessionId, cutoff.sec, cutoff.nsec],
    );

    let count = 0;
    let bytes = 0;
    const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
    for await (const cursor of index.iterate(range)) {
      count++;
      bytes += eventSize(cursor.value as MessageEvent);
      keys.push(cursor.primaryKey);
    }
    for (const key of keys) {
      await tx.store.delete(key);
    }

    await tx.done;
    return { count, bytes };
  }

  async #pruneOldestUntilSize(
    sessionId: string,
    targetSize: number,
    startingApproximateSize: number,
  ): Promise<{ count: number; bytes: number }> {
    let totalDeletedCount = 0;
    let totalDeletedBytes = 0;
    let currentApproximateSize = startingApproximateSize;
    const BATCH_SIZE = 100;

    while (currentApproximateSize > targetSize) {
      const db = await this.#dbPromise;
      const tx = db.transaction(STORE, "readwrite");
      const index = tx.store.index("bySessionTime");
      const range = IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      );

      const keys: [sessionId: string, sec: number, nsec: number, seq: number][] = [];
      let batchDeletedBytes = 0;

      for await (const cursor of index.iterate(range)) {
        keys.push(cursor.primaryKey);
        batchDeletedBytes += eventSize(cursor.value as MessageEvent);
        if (keys.length >= BATCH_SIZE) {
          break;
        }
      }

      for (const key of keys) {
        await tx.store.delete(key);
      }

      await tx.done;

      if (keys.length === 0) {
        break;
      }

      totalDeletedCount += keys.length;
      totalDeletedBytes += batchDeletedBytes;
      currentApproximateSize = Math.max(0, currentApproximateSize - batchDeletedBytes);
    }

    return { count: totalDeletedCount, bytes: totalDeletedBytes };
  }

  public async getMessages(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    limit?: number;
  }): Promise<readonly MessageEvent[]> {
    if (this.#closed) {
      log.debug("Skipping getMessages - store has been closed");
      return [];
    }

    const { start, end, topics, limit } = params;
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;

    const tx = db.transaction(STORE, "readonly");
    const index = tx.store.index("bySessionTime");
    const range = IDBKeyRange.bound(
      [sessionId, start.sec, start.nsec],
      [sessionId, end.sec, end.nsec],
    );

    const topicSet = topics ? new Set(topics) : undefined;
    const out: MessageEvent[] = [];
    for await (const cursor of index.iterate(range)) {
      const value = cursor.value;
      if (topicSet && !topicSet.has(value.topic)) {
        continue;
      }
      out.push(value as unknown as MessageEvent);
      if (limit != undefined && out.length >= limit) {
        break;
      }
    }
    await tx.done;
    return out;
  }

  public async getBackfillMessages(params: {
    time: Time;
    topics: readonly string[];
  }): Promise<readonly MessageEvent[]> {
    if (this.#closed) {
      log.debug("Skipping getBackfillMessages - store has been closed");
      return [];
    }

    const { time, topics } = params;
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;

    const tx = db.transaction(STORE, "readonly");
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
        if (!isGreaterThan(v.receiveTime, time)) {
          found = v;
          break;
        }
      }
      if (found) {
        results.push(found as unknown as MessageEvent);
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

    await this.#cleanupSessionData(this.#currentSessionId);
    await this.#recordSessionCreation();
    this.#appendQueue.length = 0;
    this.#messageCount = 0;
    this.#approximateSizeBytes = 0;
    this.#nextSeq = 0;
    log.debug("cleared session: ", { sessionId: this.#currentSessionId });
  }

  public async clearAll(): Promise<void> {
    if (this.#closed) {
      log.debug("Skipping clearAll - store has been closed");
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(
      [STORE, DATATYPES_STORE, SESSIONS_STORE, TOPICS_STORE, LOADED_RANGES_STORE],
      "readwrite",
    );
    await tx.objectStore(STORE).clear();
    await tx.objectStore(DATATYPES_STORE).clear();
    await tx.objectStore(SESSIONS_STORE).clear();
    await tx.objectStore(TOPICS_STORE).clear();
    await tx.objectStore(LOADED_RANGES_STORE).clear();
    await tx.done;
    this.#appendQueue.length = 0;
    this.#messageCount = 0;
    this.#approximateSizeBytes = 0;
    this.#nextSeq = 0;
    this.#lastPruneTime = undefined;
  }

  public async clearSessionsByKind(kind: CacheSessionKind): Promise<void> {
    const db = await this.#dbPromise;
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const sessionIds: string[] = [];
    for await (const cursor of tx.store.index("byKind").iterate(kind)) {
      sessionIds.push(cursor.value.sessionId);
    }
    await tx.done;

    for (const sessionId of sessionIds) {
      await this.#cleanupSessionData(sessionId);
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closing = true;

    let flushError: unknown;
    try {
      await this.flush();
    } catch (error) {
      log.warn("Error flushing pending events on close:", error);
      flushError = error;
    } finally {
      this.#closed = true;
      this.#appendQueue.length = 0;
    }

    try {
      const db = await this.#dbPromise;
      try {
        if (this.#kind === "realtime-viz") {
          await this.#updateClosedStatus(db);
        }
      } catch (error) {
        log.debug("Error marking database session closed:", error);
      }
      log.debug("Closing database", { dbName: DB_NAME, sessionId: this.#currentSessionId });
      db.close();
    } catch (error) {
      log.debug("Error closing database:", error);
    }

    if (flushError != undefined) {
      throw toError(flushError);
    }
  }

  async #updateClosedStatus(db: IDB.IDBPDatabase<MessagesDB>): Promise<void> {
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    const store = tx.objectStore(SESSIONS_STORE);
    const existing = await store.get(this.#currentSessionId);
    if (existing != undefined) {
      await store.put({ ...existing, status: "closed", lastActiveAt: Date.now() });
    }
    await tx.done;
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

    const tx = db.transaction(STORE, "readonly");
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
    const sizeUtilization = (approximateSizeBytes / this.#maxCacheSize) * 100;

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
    let totalPrunedBytes = 0;

    const timePruneResult = await this.#pruneBeforeTime(this.#currentSessionId, cutoff);
    totalPrunedCount += timePruneResult.count;
    totalPrunedBytes += timePruneResult.bytes;

    const storageAfterTimePrune = Math.max(0, initialStorage - totalPrunedBytes);
    if (storageAfterTimePrune > this.#maxCacheSize) {
      const sizePruneResult = await this.#pruneOldestUntilSize(
        this.#currentSessionId,
        this.#maxCacheSize * 0.9,
        storageAfterTimePrune,
      );
      totalPrunedCount += sizePruneResult.count;
      totalPrunedBytes += sizePruneResult.bytes;
    }

    this.#messageCount = Math.max(0, this.#messageCount - totalPrunedCount);
    this.#approximateSizeBytes = Math.max(0, initialStorage - totalPrunedBytes);
    this.#lastPruneTime = now;
    await this.#updateSessionMetadata({
      approximateSizeBytes: this.#approximateSizeBytes,
      messageCount: this.#messageCount,
    });

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
    if (this.#closed || this.#closing) {
      log.debug("Skipping storeDatatypes - store has been closed");
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(DATATYPES_STORE, "readwrite");
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
    await tx.done;
  }

  public async getDatatypes(): Promise<RosDatatypes | undefined> {
    if (this.#closed) {
      log.debug("Skipping getDatatypes - store has been closed");
      return undefined;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(DATATYPES_STORE, "readonly");
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
    if (this.#closed || this.#closing) {
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(TOPICS_STORE, "readwrite");
    const store = tx.objectStore(TOPICS_STORE);
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

    await tx.done;
  }

  public async getTopics(): Promise<readonly TopicMetadata[]> {
    if (this.#closed) {
      return [];
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(TOPICS_STORE, "readonly");
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

  public async putLoadedRange(range: Omit<LoadedRange, "id" | "updatedAt">): Promise<void> {
    if (this.#closed || this.#closing) {
      return;
    }
    const db = await this.#dbPromise;
    const id = `${range.sessionId}:${range.topicFingerprint}:${range.start.sec}:${range.start.nsec}:${range.end.sec}:${range.end.nsec}`;
    const tx = db.transaction(LOADED_RANGES_STORE, "readwrite");
    await tx.store.put({ ...range, id, updatedAt: Date.now() });
    await tx.done;
  }

  public async getLoadedRanges(topicFingerprint: string): Promise<readonly LoadedRange[]> {
    if (this.#closed) {
      return [];
    }
    const db = await this.#dbPromise;
    const tx = db.transaction(LOADED_RANGES_STORE, "readonly");
    const range = IDBKeyRange.bound(
      [this.#currentSessionId, topicFingerprint, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      [this.#currentSessionId, topicFingerprint, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    );
    const out: LoadedRange[] = [];
    for await (const cursor of tx.store.index("bySessionFingerprintStart").iterate(range)) {
      out.push(cursor.value);
    }
    await tx.done;
    return out;
  }
}

export async function clearIndexedDbMessageStoreDatabase(): Promise<void> {
  await IDB.deleteDB(DB_NAME);
}
