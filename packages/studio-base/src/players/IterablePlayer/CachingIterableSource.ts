// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";
import race from "race-as-promised";

import { minIndexBy, sortedIndexByTuple } from "@foxglove/den/collection";
import Log from "@foxglove/log";
import { add, compare, subtract, toNanoSec } from "@foxglove/rostime";
import { MessageEvent, Time } from "@foxglove/studio";
import {
  IndexedDbMessageStore,
  LoadedRange,
  type MessageCacheMetricSink,
  type MessagePageCursor,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import { estimateObjectSize } from "@foxglove/studio-base/players/messageMemoryEstimation";
import { TopicSelection } from "@foxglove/studio-base/players/types";
// CoScene
import { Range } from "@foxglove/studio-base/util/ranges";

import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";

// CoScene

const log = Log.getLogger(__filename);
const MAX_SPILL_MESSAGES_BEFORE_APPEND = 1000;
const MAX_SPILL_MESSAGES_PER_IDB_TRANSACTION = 1000;
const MAX_SPILL_MESSAGES_BEFORE_FLUSH = 5000;
const MAX_SPILL_BYTES_PER_IDB_TRANSACTION = 64 * 1024 * 1024;
const MAX_SPILL_HYDRATION_BYTES = 64 * 1024 * 1024;
const PLAYBACK_SPILL_HEARTBEAT_MS = 30 * 1000;
const PLAYBACK_SPILL_OPERATION_TIMEOUT_MS = 5 * 1000;
const PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES = 256;

class PlaybackSpillOperationTimeoutError extends Error {
  public constructor(operation: string) {
    super(`Timed out waiting for playback spill cache ${operation}`);
    this.name = "PlaybackSpillOperationTimeoutError";
  }
}

async function withPlaybackSpillDeadline<T>(
  operation: Promise<T>,
  operationName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PlaybackSpillOperationTimeoutError(operationName));
    }, PLAYBACK_SPILL_OPERATION_TIMEOUT_MS);
  });

  try {
    return await race([operation, timeout]);
  } finally {
    if (timer != undefined) {
      clearTimeout(timer);
    }
  }
}

function createPlaybackSpillSessionId(sourceId: string): string {
  return `playback-spill:${sourceId}:${globalThis.crypto.randomUUID()}`;
}

function finiteNonNegativeSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validatedCacheSize(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite, non-negative number`);
  }
  return value;
}

function safeEstimateObjectSize(value: unknown): number | undefined {
  try {
    return finiteNonNegativeSize(estimateObjectSize(value));
  } catch {
    return undefined;
  }
}

type MessageSizeEstimates = {
  memorySizeInBytes: number;
  persistedSizeInBytes: number;
};

function estimateMessageSizes(message: MessageEvent): MessageSizeEstimates {
  const memorySizeInBytes = Math.max(
    finiteNonNegativeSize(message.sizeInBytes) ?? 0,
    safeEstimateObjectSize(message.message) ?? 0,
  );
  return {
    memorySizeInBytes,
    persistedSizeInBytes: Math.min(
      Number.MAX_SAFE_INTEGER,
      memorySizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
    ),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value != undefined && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = canonicalize(input[key] ?? "__undefined__");
    }
    return output;
  }
  return value ?? "__undefined__";
}

function stableStringDigest(value: string): string {
  // FNV-1a matches the synchronous fallback already used for extension source revisions. A
  // fixed-width digest keeps IndexedDB compound keys bounded without adding asynchronous hashing
  // to the playback iterator lifecycle.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function topicFingerprint(topics: TopicSelection): string {
  const entries = Array.from(topics.entries())
    .map(([topicName, payload]) => ({
      topic: topicName,
      fields: payload.fields ?? "__undefined__",
      preloadType: payload.preloadType ?? "__undefined__",
    }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
  return `v3:${stableStringDigest(JSON.stringify(canonicalize(entries)) ?? "")}`;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error != undefined &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function isAborted(abortSignal: AbortSignal | undefined): boolean {
  return abortSignal?.aborted === true;
}

// An individual cache item represents a continuous range of CacheIteratorItems
type CacheBlock<MessageType> = {
  // Unique id of the cache item.
  id: bigint;

  // The start time of the cache item (inclusive).
  //
  // When reading a data source, the first message may come after the requested "start" time.
  // The start field is the request start time while the first item in items would be the first message
  // which may be after this time.
  //
  // The start time is <= first item time.
  start: Time;

  // The end time (inclusive) of the last message within the cache item. Similar to start, the data source
  // may "end" after the last message so.
  //
  // The end time is >= last item time.
  end: Time;

  // Sorted cache item tuples. The first value is the timestamp of the iterator result and the second is the result.
  items: [bigint, IteratorResult<MessageType>][];

  // The last time this block was accessed.
  lastAccess: number;

  // The size of this block in bytes
  size: number;
};

type PendingCacheItem<MessageType> = {
  cacheItem: [bigint, IteratorResult<MessageType>];
  memorySizeInBytes: number;
  persistedSizeInBytes: number;
};

type PendingSpillMessage = {
  message: MessageEvent;
  estimatedSizeInBytes: number;
};

type Options = {
  maxBlockSize?: number;
  maxTotalSize?: number;
  spillCache?: {
    sourceId: string;
    metricSink?: MessageCacheMetricSink;
  };
};

interface EventTypes {
  /** Dispatched when the loaded ranges have changed. Use `loadedRanges()` to get the new ranges. */
  loadedRangesChange: () => void;
}

type SpillRangeReadResult =
  | { complete: true }
  | {
      complete: false;
      resumeFrom: Time;
      directSource: boolean;
    };

/**
 * CachingIterableSource proxies access to IIterableSource through a memory buffer.
 *
 * Message reading occurs from the memory buffer containing previously read messages. If there is no
 * buffer for previously read messages, then the underlying source is used and the messages are
 * cached when read.
 */
class CachingIterableSource<MessageType = unknown>
  extends EventEmitter<EventTypes>
  implements IIterableSource<MessageType>
{
  #source: IIterableSource<MessageType>;

  // Stores which topics we have been caching. See notes at usage site for why we store this.
  #cachedTopics: TopicSelection = new Map();
  #topicGeneration = 0;
  #topicResetPromise: Promise<void> = Promise.resolve();

  // The producer loads results into the cache and the consumer reads from the cache.
  #cache: CacheBlock<MessageType>[] = [];

  // Cache of loaded ranges. Ranges correspond to the cache blocks and are normalized in [0, 1];
  #loadedRangesCache: Range[] = [{ start: 0, end: 0 }];

  #initResult?: Initalization;

  #totalSizeBytes: number = 0;

  // Maximum total cache size
  #maxTotalSizeBytes: number;

  // Maximum size per block
  #maxBlockSizeBytes: number;

  // The current read head, used for determining which blocks are evictable
  #currentReadHead: Time = { sec: 0, nsec: 0 };

  #nextBlockId: bigint = BigInt(0);
  #evictableBlockCandidates: CacheBlock<MessageType>["id"][] = [];
  #spillStore?: IndexedDbMessageStore;
  #spillEnabled = true;
  #spillCacheOptions?: NonNullable<Options["spillCache"]>;
  #spillTopicFingerprint?: string;
  #spillLoadedRanges: readonly LoadedRange[] = [];
  #spillLoadedRangesContentRevision: number | undefined;
  #spillMessageCountSinceFlush = 0;
  #spillEstimatedBytesSinceFlush = 0;
  #spillLastSessionCheckAt: number | undefined;
  #spillHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #spillPageHideHandler: ((event: PageTransitionEvent) => void) | undefined;
  #spillPageShowHandler: ((event: PageTransitionEvent) => void) | undefined;
  #spillVisibilityChangeHandler: (() => void) | undefined;
  #spillRecoveryPromise: Promise<void> | undefined;
  #spillMutationTail: Promise<void> = Promise.resolve();
  #spillSealPromise: Promise<void> | undefined;
  #terminated = false;
  #terminatePromise: Promise<void> | undefined;

  public constructor(source: IIterableSource<MessageType>, opt?: Options) {
    super();

    this.#source = source;
    this.#maxTotalSizeBytes = validatedCacheSize(opt?.maxTotalSize ?? 629145600, "maxTotalSize"); // 600MB (was 1GB, reduced to mitigate OOM issues)
    this.#maxBlockSizeBytes = validatedCacheSize(opt?.maxBlockSize ?? 52428800, "maxBlockSize"); // 50MB
    this.#spillCacheOptions = opt?.spillCache;
  }

  public async initialize(): Promise<Initalization> {
    this.#initResult = await this.#source.initialize();
    if (!this.#terminated) {
      await this.#initSpillCache();
    }
    return this.#initResult;
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public terminate(): Promise<void> {
    this.#terminated = true;
    this.#spillEnabled = false;
    this.#stopSpillLifecycleHandlers();
    this.#terminatePromise ??= this.#terminateImpl();
    return this.#terminatePromise;
  }

  async #terminateImpl(): Promise<void> {
    this.#cache.length = 0;
    this.#cachedTopics.clear();
    this.#totalSizeBytes = 0;

    // Recovery owns whichever store it detached. Wait for it to finish so terminate does not
    // resolve while that connection is still closing or allow it to create a replacement store.
    await this.#spillMutationTail;
    await this.#sealSpillCache("pending-delete");
  }

  async #runSpillMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#spillMutationTail.then(operation, operation);
    this.#spillMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
  }

  public loadedRanges(): Range[] {
    return this.#loadedRangesCache;
  }

  public getCacheSize(): number {
    return this.#totalSizeBytes;
  }

  async #resetForTopicsIfNeeded(topics: TopicSelection): Promise<number> {
    if (_.isEqual(topics, this.#cachedTopics)) {
      const topicGeneration = this.#topicGeneration;
      const resetPromise = this.#topicResetPromise;
      await resetPromise;
      return topicGeneration;
    }

    log.debug("topics changed - clearing cache, resetting range");
    this.#cachedTopics = new Map(topics);
    const topicGeneration = ++this.#topicGeneration;
    this.#cache.length = 0;
    this.#totalSizeBytes = 0;
    this.#recomputeLoadedRangeCache();
    const resetPromise = this.#resetSpillForTopics(this.#cachedTopics);
    this.#topicResetPromise = resetPromise;
    try {
      await resetPromise;
    } finally {
      if (this.#topicResetPromise === resetPromise) {
        this.#topicResetPromise = Promise.resolve();
      }
    }
    return topicGeneration;
  }

  async #initSpillCache(): Promise<boolean> {
    if (this.#spillCacheOptions == undefined || this.#spillStore != undefined) {
      return this.#spillStore != undefined;
    }
    if (!this.#spillEnabled || this.#terminated) {
      return false;
    }

    let store: IndexedDbMessageStore | undefined;
    try {
      store = new IndexedDbMessageStore({
        sessionId: createPlaybackSpillSessionId(this.#spillCacheOptions.sourceId),
        kind: "playback-spill",
        retentionWindowMs: Number.MAX_SAFE_INTEGER,
        sourceId: this.#spillCacheOptions.sourceId,
        appendBatchMaxSize: MAX_SPILL_MESSAGES_PER_IDB_TRANSACTION,
        metricSink: this.#spillCacheOptions.metricSink,
      });
      this.#spillStore = store;
      await store.init();
      if (!this.#isCurrentSpillStore(store)) {
        return false;
      }
      if (!store.isWritable()) {
        throw new Error("Playback spill cache is unavailable for writes");
      }
      this.#spillLastSessionCheckAt = Date.now();
      this.#startSpillLifecycleHandlers();
      return true;
    } catch (error) {
      if (store == undefined) {
        log.warn("Disabling playback spill cache after construction failed:", error);
        this.#spillEnabled = false;
        this.#stopSpillLifecycleHandlers();
        return false;
      }
      await this.#disableSpillCache(
        "Disabling playback spill cache after initialization failed:",
        error,
        store,
        { waitForSeal: true },
      );
      return false;
    }
  }

  #isCurrentSpillStore(store: IndexedDbMessageStore): boolean {
    return !this.#terminated && this.#spillEnabled && store === this.#spillStore;
  }

  #isCurrentTopicGeneration(topicGeneration: number): boolean {
    return !this.#terminated && topicGeneration === this.#topicGeneration;
  }

  #isCurrentSpillContext(
    store: IndexedDbMessageStore,
    topicGeneration: number,
    expectedTopicFingerprint: string,
  ): boolean {
    return (
      this.#isCurrentTopicGeneration(topicGeneration) &&
      this.#spillTopicFingerprint === expectedTopicFingerprint &&
      this.#isCurrentSpillStore(store)
    );
  }

  async #sealSpillCache(status: "pending-delete" | "abandoned"): Promise<void> {
    const store = this.#spillStore;
    if (store == undefined) {
      await this.#spillSealPromise;
      return;
    }

    this.#spillStore = undefined;
    this.#spillTopicFingerprint = undefined;
    this.#spillLoadedRanges = [];
    this.#spillLoadedRangesContentRevision = undefined;
    this.#spillMessageCountSinceFlush = 0;
    this.#spillEstimatedBytesSinceFlush = 0;
    this.#spillLastSessionCheckAt = undefined;

    const sealPromise = store.discardAndSeal(status).catch((error: unknown) => {
      log.debug("Failed to seal playback spill cache:", error);
    });
    this.#spillSealPromise = sealPromise;
    try {
      await sealPromise;
    } finally {
      if (this.#spillSealPromise === sealPromise) {
        this.#spillSealPromise = undefined;
      }
    }
  }

  async #disableSpillCache(
    message: string,
    error: unknown,
    store: IndexedDbMessageStore,
    options: { waitForSeal?: boolean } = {},
  ): Promise<void> {
    if (store !== this.#spillStore) {
      return;
    }
    log.warn(message, error);
    this.#spillEnabled = false;
    this.#stopSpillLifecycleHandlers();
    const sealPromise = this.#sealSpillCache("abandoned");
    if (options.waitForSeal === true) {
      await sealPromise;
    } else {
      // Reads and playback must fail open at their own five-second deadline. terminate() observes
      // #spillSealPromise and still waits for bounded teardown before reporting the player closed.
      void sealPromise;
    }
    if (this.#initResult != undefined) {
      this.#recomputeLoadedRangeCache();
    }
  }

  #startSpillLifecycleHandlers(): void {
    if (this.#terminated) {
      return;
    }

    if (this.#spillHeartbeatTimer == undefined) {
      this.#spillHeartbeatTimer = setInterval(() => {
        void this.#ensureSpillSessionAlive({ force: false });
      }, PLAYBACK_SPILL_HEARTBEAT_MS);
    }

    if (typeof window !== "undefined" && this.#spillPageHideHandler == undefined) {
      this.#spillPageHideHandler = (event: PageTransitionEvent) => {
        if (event.persisted) {
          return;
        }
        this.#terminated = true;
        this.#spillEnabled = false;
        this.#stopSpillLifecycleHandlers();
        void this.#runSpillMutation(async () => {
          await this.#sealSpillCache("pending-delete");
        });
      };
      window.addEventListener("pagehide", this.#spillPageHideHandler);
    }

    if (typeof window !== "undefined" && this.#spillPageShowHandler == undefined) {
      this.#spillPageShowHandler = () => {
        void this.#ensureSpillSessionAlive({ force: true });
      };
      window.addEventListener("pageshow", this.#spillPageShowHandler);
    }

    if (typeof document !== "undefined" && this.#spillVisibilityChangeHandler == undefined) {
      this.#spillVisibilityChangeHandler = () => {
        if (document.visibilityState === "visible") {
          void this.#ensureSpillSessionAlive({ force: true });
        }
      };
      document.addEventListener("visibilitychange", this.#spillVisibilityChangeHandler);
    }
  }

  #stopSpillLifecycleHandlers(): void {
    if (this.#spillHeartbeatTimer != undefined) {
      clearInterval(this.#spillHeartbeatTimer);
      this.#spillHeartbeatTimer = undefined;
    }
    if (typeof window !== "undefined" && this.#spillPageHideHandler != undefined) {
      window.removeEventListener("pagehide", this.#spillPageHideHandler);
      this.#spillPageHideHandler = undefined;
    }
    if (typeof window !== "undefined" && this.#spillPageShowHandler != undefined) {
      window.removeEventListener("pageshow", this.#spillPageShowHandler);
      this.#spillPageShowHandler = undefined;
    }
    if (typeof document !== "undefined" && this.#spillVisibilityChangeHandler != undefined) {
      document.removeEventListener("visibilitychange", this.#spillVisibilityChangeHandler);
      this.#spillVisibilityChangeHandler = undefined;
    }
  }

  async #ensureSpillSessionAlive(opt: { force?: boolean } = {}): Promise<boolean> {
    if (this.#terminated) {
      return false;
    }
    if (this.#spillRecoveryPromise != undefined) {
      await this.#spillRecoveryPromise;
      // Recovery may be interrupted by terminate while the await above is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      return !this.#terminated && this.#spillEnabled && this.#spillStore != undefined;
    }

    const store = this.#spillStore;
    if (!this.#spillEnabled || store == undefined) {
      return false;
    }
    if (!store.isWritable()) {
      await this.#disableSpillCache(
        "Disabling playback spill cache because the session is no longer writable:",
        new Error("Playback spill cache is unavailable for writes"),
        store,
      );
      return false;
    }

    const now = Date.now();
    if (
      opt.force !== true &&
      this.#spillLastSessionCheckAt != undefined &&
      now - this.#spillLastSessionCheckAt < PLAYBACK_SPILL_HEARTBEAT_MS
    ) {
      return true;
    }

    let alive: boolean;
    try {
      alive = await withPlaybackSpillDeadline(store.touchSession(), "session heartbeat");
    } catch (error) {
      await this.#disableSpillCache(
        "Disabling playback spill cache after session touch failed:",
        error,
        store,
      );
      return false;
    }

    if (store !== this.#spillStore) {
      return false;
    }

    if (alive) {
      this.#spillLastSessionCheckAt = Date.now();
      return true;
    }

    await this.#recoverSpillCache();
    return false;
  }

  async #recoverSpillCache(): Promise<void> {
    if (this.#terminated || !this.#spillEnabled) {
      return;
    }
    if (this.#spillRecoveryPromise != undefined) {
      await this.#spillRecoveryPromise;
      return;
    }

    this.#spillRecoveryPromise = this.#runSpillMutation(async () => {
      await this.#recoverSpillCacheImpl();
    });
    try {
      await this.#spillRecoveryPromise;
    } finally {
      this.#spillRecoveryPromise = undefined;
    }
  }

  async #recoverSpillCacheImpl(): Promise<void> {
    const savedFingerprint = this.#spillTopicFingerprint;

    try {
      await this.#sealSpillCache("abandoned");
      if (this.#terminated || !this.#spillEnabled) {
        return;
      }
      const initialized = await this.#initSpillCache();
      const store = this.#spillStore;
      if (!initialized || store == undefined || !this.#isCurrentSpillStore(store)) {
        return;
      }
      if (savedFingerprint != undefined) {
        await withPlaybackSpillDeadline(
          store.setTopicFingerprint(savedFingerprint),
          "topic recovery",
        );
        if (!this.#isCurrentSpillStore(store)) {
          return;
        }
        this.#spillTopicFingerprint = savedFingerprint;
      }
      this.#spillLoadedRanges = [];
      this.#spillLoadedRangesContentRevision = undefined;
      this.#spillMessageCountSinceFlush = 0;
      this.#spillEstimatedBytesSinceFlush = 0;
      this.#spillLastSessionCheckAt = Date.now();
      this.#recomputeLoadedRangeCache();
    } catch (error) {
      this.#spillEnabled = false;
      this.#stopSpillLifecycleHandlers();
      log.warn("Disabling playback spill cache after session recovery failed:", error);
      await this.#sealSpillCache("abandoned");
      if (this.#initResult != undefined) {
        this.#recomputeLoadedRangeCache();
      }
    }
  }

  async #resetSpillForTopics(topics: TopicSelection): Promise<void> {
    await this.#runSpillMutation(async () => {
      await this.#resetSpillForTopicsImpl(topics);
    });
  }

  async #resetSpillForTopicsImpl(topics: TopicSelection): Promise<void> {
    const store = this.#spillStore;
    if (!this.#spillEnabled || this.#terminated || store == undefined) {
      return;
    }

    const nextFingerprint = topicFingerprint(topics);
    if (this.#spillTopicFingerprint === nextFingerprint) {
      return;
    }

    try {
      // The first topic selection can initialize the empty session in place. Later changes must
      // seal the populated session so queued writes are discarded instead of flushed before clear.
      if (this.#spillTopicFingerprint == undefined) {
        await withPlaybackSpillDeadline(
          store.setTopicFingerprint(nextFingerprint),
          "topic initialization",
        );
        if (!this.#isCurrentSpillStore(store)) {
          return;
        }
        this.#spillTopicFingerprint = nextFingerprint;
        this.#spillLoadedRanges = [];
        this.#spillLoadedRangesContentRevision = undefined;
        this.#spillMessageCountSinceFlush = 0;
        this.#spillEstimatedBytesSinceFlush = 0;
        this.#recomputeLoadedRangeCache();
        return;
      }

      // The old topic session is disposable. Seal it without flushing queued writes and let the
      // janitor reclaim it instead of synchronously rewriting data that will be deleted.
      await this.#sealSpillCache("pending-delete");
      // terminate() may change both flags while the seal is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.#terminated || !this.#spillEnabled) {
        return;
      }
      const initialized = await this.#initSpillCache();
      const nextStore = this.#spillStore;
      // Initialization and terminate() can replace or detach the store while awaiting.
      if (!initialized || nextStore == undefined || !this.#isCurrentSpillStore(nextStore)) {
        return;
      }
      await withPlaybackSpillDeadline(
        nextStore.setTopicFingerprint(nextFingerprint),
        "topic reset",
      );
      if (!this.#isCurrentSpillStore(nextStore)) {
        return;
      }
      this.#spillTopicFingerprint = nextFingerprint;
      this.#spillLoadedRanges = [];
      this.#spillLoadedRangesContentRevision = undefined;
      this.#spillMessageCountSinceFlush = 0;
      this.#spillEstimatedBytesSinceFlush = 0;
      this.#recomputeLoadedRangeCache();
    } catch (error) {
      const currentStore = this.#spillStore;
      // An asynchronous seal or initialization failure may have detached the original store.
      if (currentStore != undefined) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after topic reset failed:",
          error,
          currentStore,
        );
      } else {
        this.#spillEnabled = false;
        this.#stopSpillLifecycleHandlers();
        log.warn("Disabling playback spill cache after topic reset failed:", error);
      }
    }
  }

  async #appendSpillMessages(
    pendingMessages: readonly PendingSpillMessage[],
    expectedStore: IndexedDbMessageStore | undefined,
    expectedTopicGeneration: number,
    expectedTopicFingerprint: string,
  ): Promise<boolean> {
    const store = expectedStore;
    if (
      !this.#spillEnabled ||
      this.#terminated ||
      store == undefined ||
      !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint) ||
      pendingMessages.length === 0
    ) {
      return false;
    }

    try {
      const messages = pendingMessages.map((item) => item.message);
      const estimatedSizes = pendingMessages.map((item) => item.estimatedSizeInBytes);
      if (estimatedSizes.some((size) => size > MAX_SPILL_BYTES_PER_IDB_TRANSACTION)) {
        log.warn("Skipping playback spill coverage for a range containing an oversized message");
        return false;
      }

      let offset = 0;
      while (offset < messages.length) {
        let end = offset;
        let chunkBytes = 0;
        while (end < messages.length && end - offset < MAX_SPILL_MESSAGES_PER_IDB_TRANSACTION) {
          const nextSize = estimatedSizes[end]!;
          if (end > offset && chunkBytes + nextSize > MAX_SPILL_BYTES_PER_IDB_TRANSACTION) {
            break;
          }
          chunkBytes += nextSize;
          end++;
        }
        const chunk = messages.slice(offset, end);
        await withPlaybackSpillDeadline(
          store.append(chunk, { estimatedSizeBytes: estimatedSizes.slice(offset, end) }),
          "append",
        );
        if (
          !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)
        ) {
          return false;
        }
        this.#spillMessageCountSinceFlush += chunk.length;
        this.#spillEstimatedBytesSinceFlush += chunkBytes;
        if (
          this.#spillMessageCountSinceFlush >= MAX_SPILL_MESSAGES_BEFORE_FLUSH ||
          this.#spillEstimatedBytesSinceFlush >= MAX_SPILL_BYTES_PER_IDB_TRANSACTION
        ) {
          await withPlaybackSpillDeadline(store.flush(), "append flush");
          if (
            !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)
          ) {
            return false;
          }
          this.#spillMessageCountSinceFlush = 0;
          this.#spillEstimatedBytesSinceFlush = 0;
        }
        offset = end;
      }
      return true;
    } catch (error) {
      if (this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after append failed:",
          error,
          store,
        );
      }
      return false;
    }
  }

  async #recordSpillLoadedRange(
    start: Time,
    end: Time,
    expectedStore: IndexedDbMessageStore | undefined,
    expectedContentRevision: number | undefined,
    expectedTopicGeneration: number,
    expectedTopicFingerprint: string,
  ): Promise<void> {
    const store = expectedStore;
    if (
      !this.#spillEnabled ||
      this.#terminated ||
      store == undefined ||
      !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint) ||
      compare(start, end) > 0
    ) {
      return;
    }

    try {
      await withPlaybackSpillDeadline(store.flush(), "loaded range flush");
      if (!this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        return;
      }
      this.#spillMessageCountSinceFlush = 0;
      this.#spillEstimatedBytesSinceFlush = 0;
      if (
        expectedContentRevision == undefined ||
        !store.isWritable() ||
        store.getContentRevision() !== expectedContentRevision
      ) {
        await this.#refreshSpillLoadedRanges(
          store,
          expectedTopicFingerprint,
          expectedTopicGeneration,
        );
        return;
      }
      const recorded = await withPlaybackSpillDeadline(
        store.putLoadedRange(
          {
            sessionId: store.getSessionId(),
            topicFingerprint: expectedTopicFingerprint,
            start,
            end,
          },
          expectedContentRevision,
        ),
        "loaded range update",
      );
      if (!this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        return;
      }
      if (!recorded) {
        await this.#refreshSpillLoadedRanges(
          store,
          expectedTopicFingerprint,
          expectedTopicGeneration,
        );
        return;
      }
      await this.#refreshSpillLoadedRanges(
        store,
        expectedTopicFingerprint,
        expectedTopicGeneration,
      );
    } catch (error) {
      if (this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after loaded range update failed:",
          error,
          store,
        );
      }
    }
  }

  #hasActiveSpillCache(topicGeneration: number, expectedTopicFingerprint: string): boolean {
    return (
      this.#spillEnabled &&
      this.#spillStore != undefined &&
      this.#isCurrentSpillContext(this.#spillStore, topicGeneration, expectedTopicFingerprint)
    );
  }

  async #refreshSpillLoadedRanges(
    store: IndexedDbMessageStore,
    expectedTopicFingerprint: string,
    expectedTopicGeneration: number,
  ): Promise<boolean> {
    const contentRevision = store.getContentRevision();
    const loadedRanges = await withPlaybackSpillDeadline(
      store.getLoadedRanges(expectedTopicFingerprint),
      "loaded range lookup",
    );
    if (!this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
      return false;
    }
    if (store.getContentRevision() !== contentRevision) {
      this.#spillLoadedRanges = [];
      this.#spillLoadedRangesContentRevision = undefined;
      this.#recomputeLoadedRangeCache();
      return false;
    }
    this.#spillLoadedRanges = loadedRanges;
    this.#spillLoadedRangesContentRevision = contentRevision;
    this.#recomputeLoadedRangeCache();
    return true;
  }

  async #getSpillLoadedRanges(
    expectedTopicGeneration: number,
    expectedTopicFingerprint: string,
  ): Promise<readonly LoadedRange[]> {
    if (!this.#isCurrentTopicGeneration(expectedTopicGeneration)) {
      return [];
    }
    const alive = await this.#ensureSpillSessionAlive();
    const store = this.#spillStore;
    if (
      !alive ||
      !this.#spillEnabled ||
      store == undefined ||
      !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)
    ) {
      return [];
    }

    try {
      const hadLoadedRanges = this.#spillLoadedRanges.length > 0;
      if (
        !(await this.#refreshSpillLoadedRanges(
          store,
          expectedTopicFingerprint,
          expectedTopicGeneration,
        ))
      ) {
        return [];
      }
      if (hadLoadedRanges && this.#spillLoadedRanges.length === 0) {
        const stillAlive = await this.#ensureSpillSessionAlive({ force: true });
        if (
          !stillAlive ||
          !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)
        ) {
          return [];
        }
      }
      return this.#spillLoadedRanges;
    } catch (error) {
      if (this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after loaded range lookup failed:",
          error,
          store,
        );
      }
      return [];
    }
  }

  async #readSpillBackfillMessages(
    args: GetBackfillMessagesArgs,
    expectedTopicGeneration: number,
    expectedTopicFingerprint: string,
  ): Promise<readonly MessageEvent[]> {
    if (!this.#isCurrentTopicGeneration(expectedTopicGeneration)) {
      return [];
    }
    const alive = await this.#ensureSpillSessionAlive();
    const store = this.#spillStore;
    if (
      !alive ||
      !this.#spillEnabled ||
      this.#terminated ||
      store == undefined ||
      !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)
    ) {
      return [];
    }

    try {
      const contentRevision = store.getContentRevision();
      const loadedRanges = await withPlaybackSpillDeadline(
        store.getLoadedRanges(expectedTopicFingerprint),
        "backfill range lookup",
      );
      if (
        !this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint) ||
        store.getContentRevision() !== contentRevision
      ) {
        return [];
      }
      const containingRange = loadedRanges.find(
        (range) => compare(range.start, args.time) <= 0 && compare(range.end, args.time) >= 0,
      );
      if (containingRange == undefined) {
        return [];
      }

      const messages = await withPlaybackSpillDeadline(
        store.getBackfillMessages({
          time: args.time,
          topics: Array.from(args.topics.keys()),
          start: containingRange.start,
        }),
        "backfill message lookup",
      );
      return this.#isCurrentSpillContext(
        store,
        expectedTopicGeneration,
        expectedTopicFingerprint,
      ) && store.getContentRevision() === contentRevision
        ? messages
        : [];
    } catch (error) {
      if (this.#isCurrentSpillContext(store, expectedTopicGeneration, expectedTopicFingerprint)) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after backfill lookup failed:",
          error,
          store,
        );
      }
      return [];
    }
  }

  async *#yieldSpillRange(args: {
    start: Time;
    end: Time;
    topics: TopicSelection;
    topicGeneration: number;
    topicFingerprint: string;
  }): AsyncGenerator<Readonly<IteratorResult<MessageType>>, SpillRangeReadResult, void> {
    let pendingTimeGroup: MessageEvent[] = [];
    let pendingTimeGroupBytes = 0;
    let yieldedCompleteTimeGroup = false;
    const incompleteResult = (): SpillRangeReadResult => ({
      complete: false,
      resumeFrom: pendingTimeGroup[0]?.receiveTime ?? args.start,
      directSource: yieldedCompleteTimeGroup || pendingTimeGroup.length > 0,
    });
    if (!this.#isCurrentTopicGeneration(args.topicGeneration)) {
      return incompleteResult();
    }
    const alive = await this.#ensureSpillSessionAlive();
    const store = this.#spillStore;
    if (
      !alive ||
      !this.#spillEnabled ||
      this.#terminated ||
      store == undefined ||
      !this.#isCurrentSpillContext(store, args.topicGeneration, args.topicFingerprint)
    ) {
      return incompleteResult();
    }

    const contentRevision = this.#spillLoadedRangesContentRevision;
    if (contentRevision == undefined || store.getContentRevision() !== contentRevision) {
      return incompleteResult();
    }
    const hydrationBudget = Math.max(
      0,
      Math.min(this.#maxBlockSizeBytes, this.#maxTotalSizeBytes, MAX_SPILL_HYDRATION_BYTES),
    );
    const minimumBufferedMessageBytes = Math.max(
      1,
      Math.min(PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES, hydrationBudget),
    );
    let after: MessagePageCursor | undefined;

    try {
      for (;;) {
        const page = await withPlaybackSpillDeadline(
          store.getMessagesPage({
            start: args.start,
            end: args.end,
            topics: Array.from(args.topics.keys()),
            maxEstimatedBytes: hydrationBudget,
            ...(after == undefined ? {} : { after }),
          }),
          "message page lookup",
        );
        if (
          !this.#isCurrentSpillContext(store, args.topicGeneration, args.topicFingerprint) ||
          store.getContentRevision() !== contentRevision
        ) {
          return incompleteResult();
        }
        if (page == undefined) {
          await this.#disableSpillCache(
            "Disabling playback spill cache because a persisted range is inactive:",
            new Error("Playback spill session is no longer active"),
            store,
          );
          return incompleteResult();
        }

        for (const message of page.messages) {
          const pendingTime = pendingTimeGroup[0]?.receiveTime;
          if (pendingTime != undefined) {
            const timeComparison = compare(pendingTime, message.receiveTime);
            if (timeComparison > 0) {
              throw new Error("Playback spill pages were not ordered by receive time");
            }
            if (timeComparison < 0) {
              for (const pendingMessage of pendingTimeGroup) {
                yield {
                  type: "message-event",
                  msgEvent: pendingMessage as MessageEvent<MessageType>,
                };
              }
              yieldedCompleteTimeGroup = true;
              pendingTimeGroup = [];
              pendingTimeGroupBytes = 0;
            }
          }
          pendingTimeGroup.push(message);
          pendingTimeGroupBytes += Math.max(
            minimumBufferedMessageBytes,
            estimateMessageSizes(message).memorySizeInBytes,
          );
          if (pendingTimeGroupBytes > hydrationBudget) {
            // A failure or fallback may replay a same-timestamp group in a different order. Keep
            // that tail uncommitted and restart it from the source instead of count-based deduping.
            return incompleteResult();
          }
        }
        if (page.complete) {
          for (const pendingMessage of pendingTimeGroup) {
            yield {
              type: "message-event",
              msgEvent: pendingMessage as MessageEvent<MessageType>,
            };
          }
          return { complete: true };
        }
        if (page.nextCursor == undefined) {
          throw new Error("Playback spill pagination did not provide a continuation cursor");
        }
        if (
          after != undefined &&
          after.seq === page.nextCursor.seq &&
          compare(after.receiveTime, page.nextCursor.receiveTime) === 0
        ) {
          throw new Error("Playback spill pagination did not advance");
        }
        after = page.nextCursor;
      }
    } catch (error) {
      if (this.#isCurrentSpillContext(store, args.topicGeneration, args.topicFingerprint)) {
        await this.#disableSpillCache(
          "Disabling playback spill cache after message page lookup failed:",
          error,
          store,
        );
      }
      return incompleteResult();
    }
  }

  async *#yieldSourceRangeDirect(args: {
    start: Time;
    end: Time;
    topics: TopicSelection;
    consumptionType: MessageIteratorArgs["consumptionType"];
    fetchCompleteTopicState: MessageIteratorArgs["fetchCompleteTopicState"];
    abortSignal?: AbortSignal;
  }): AsyncGenerator<Readonly<IteratorResult<MessageType>>, boolean, void> {
    if (isAborted(args.abortSignal)) {
      return false;
    }
    try {
      for await (const iterResult of this.#source.messageIterator({
        topics: args.topics,
        start: args.start,
        end: args.end,
        consumptionType: args.consumptionType,
        fetchCompleteTopicState: args.fetchCompleteTopicState,
        abortSignal: args.abortSignal,
      })) {
        if (isAborted(args.abortSignal)) {
          return false;
        }
        if (iterResult.type === "message-event" || iterResult.type === "stamp") {
          const resultTime =
            iterResult.type === "message-event"
              ? iterResult.msgEvent.receiveTime
              : iterResult.stamp;
          if (compare(resultTime, args.start) < 0) {
            continue;
          }
          if (compare(resultTime, args.end) > 0) {
            return true;
          }
        }
        yield iterResult;
      }
      return !isAborted(args.abortSignal);
    } catch (error) {
      if (isAborted(args.abortSignal) && isAbortError(error)) {
        return false;
      }
      throw error;
    }
  }

  async *#yieldSourceRange(args: {
    start: Time;
    end: Time;
    topics: TopicSelection;
    consumptionType: MessageIteratorArgs["consumptionType"];
    fetchCompleteTopicState: MessageIteratorArgs["fetchCompleteTopicState"];
    abortSignal?: AbortSignal;
    writeSpill: boolean;
    topicGeneration: number;
    topicFingerprint: string;
  }): AsyncGenerator<Readonly<IteratorResult<MessageType>>, boolean, void> {
    if (isAborted(args.abortSignal)) {
      return false;
    }

    const sourceMessageIterator = this.#source.messageIterator({
      topics: args.topics,
      start: args.start,
      end: args.end,
      consumptionType: args.consumptionType,
      fetchCompleteTopicState: args.fetchCompleteTopicState,
      abortSignal: args.abortSignal,
    });

    // The cache is indexed on time, but iterator results that are problems might not have a time.
    // For these we use the lastTime that we knew about (or had a message for).
    // This variable tracks the last known time from a read.
    let readHead = args.start;
    let lastTime = toNanoSec(args.start);
    let sourceHadProblemInRange = false;
    let spillRangeStart = args.start;
    let spillRangeStore = this.#spillStore;
    if (
      spillRangeStore != undefined &&
      !this.#isCurrentSpillContext(spillRangeStore, args.topicGeneration, args.topicFingerprint)
    ) {
      spillRangeStore = undefined;
    }
    let spillRangeContentRevision = spillRangeStore?.getContentRevision();
    let spillRangeWritesComplete = spillRangeStore != undefined;
    let block: CacheBlock<MessageType> | undefined;

    const pendingIterResults: PendingCacheItem<MessageType>[] = [];
    let pendingSpillMessages: PendingSpillMessage[] = [];
    let pendingSpillEstimatedBytes = 0;
    const discardPendingIterResults = () => {
      if (this.#isCurrentTopicGeneration(args.topicGeneration)) {
        for (const pendingItem of pendingIterResults) {
          this.#totalSizeBytes -= pendingItem.memorySizeInBytes;
        }
      }
      pendingIterResults.length = 0;
    };
    const discardPendingSpillMessages = () => {
      pendingSpillMessages = [];
      pendingSpillEstimatedBytes = 0;
    };
    const flushPendingSpillMessages = async (): Promise<boolean> => {
      if (pendingSpillMessages.length === 0) {
        return true;
      }
      const messages = pendingSpillMessages;
      pendingSpillMessages = [];
      pendingSpillEstimatedBytes = 0;
      const appended = await this.#appendSpillMessages(
        messages,
        spillRangeStore,
        args.topicGeneration,
        args.topicFingerprint,
      );
      spillRangeWritesComplete &&= appended;
      return appended;
    };

    try {
      for await (const iterResult of sourceMessageIterator) {
        if (isAborted(args.abortSignal)) {
          discardPendingIterResults();
          discardPendingSpillMessages();
          return false;
        }

        // A newer iterator may have changed topics while this source was awaiting data. Continue
        // serving the old iterator, but never let it repopulate the new topic generation's memory
        // or spill cache (including an A -> B -> A switch with the same fingerprint).
        if (!this.#isCurrentTopicGeneration(args.topicGeneration)) {
          pendingIterResults.length = 0;
          discardPendingSpillMessages();
          block = undefined;
          yield iterResult;
          continue;
        }

        if (iterResult.type === "problem") {
          sourceHadProblemInRange = true;
        }

        // if there is no block, we make a new block
        if (!block) {
          const newBlock: CacheBlock<MessageType> = {
            id: this.#nextBlockId++,
            start: readHead,
            end: readHead,
            items: [],
            size: 0,
            lastAccess: Date.now(),
          };

          // Find where we need to insert our new block.
          // It should come before any blocks with a start time > than new block start time.
          const insertIndex = _.sortedIndexBy(this.#cache, newBlock, (item) =>
            toNanoSec(item.start),
          );
          this.#cache.splice(insertIndex, 0, newBlock);

          block = newBlock;
          this.#recomputeLoadedRangeCache();
        }

        // When receiving a message event or stamp, we update our known time on the block to the
        // stamp or receiveTime because we know we've received all the results up to this time
        if (iterResult.type === "message-event" || iterResult.type === "stamp") {
          const receiveTime =
            iterResult.type === "stamp" ? iterResult.stamp : iterResult.msgEvent.receiveTime;
          const receiveTimeNs = toNanoSec(receiveTime);

          // There might be multiple messages at the same time, and since block end time
          // is inclusive we only update the end time once we've moved to the next time
          if (receiveTimeNs > lastTime) {
            // write any pending messages to the block
            for (const pendingItem of pendingIterResults) {
              block.items.push(pendingItem.cacheItem);
              block.size += pendingItem.memorySizeInBytes;
            }

            pendingIterResults.length = 0;

            // update the last time this block was accessed
            block.lastAccess = Date.now();

            // Set the end time to 1 nanosecond before the current receive time since we know we've
            // read up to this receive time.
            block.end = subtract(receiveTime, { sec: 0, nsec: 1 });

            lastTime = receiveTimeNs;
            this.#recomputeLoadedRangeCache();
          }
        }

        // Block is too big so we close it and will start a new one next loop
        if (block.size >= this.#maxBlockSizeBytes) {
          // The new block starts right after our previous one
          readHead = add(block.end, { sec: 0, nsec: 1 });

          // Will force creation of a new block on the next loop
          block = undefined;
        }

        const sizeEstimates =
          iterResult.type === "message-event"
            ? estimateMessageSizes(iterResult.msgEvent as MessageEvent)
            : { memorySizeInBytes: 0, persistedSizeInBytes: 0 };
        if (
          this.#maybePurgeCache({
            activeBlock: block,
            sizeInBytes: sizeEstimates.memorySizeInBytes,
          })
        ) {
          this.#recomputeLoadedRangeCache();
        }

        // As we add items to pending we also consider them as part of the total size
        this.#totalSizeBytes += sizeEstimates.memorySizeInBytes;

        // Store the latest message in pending results and flush to the block when time moves forward
        const pendingItem: PendingCacheItem<MessageType> = {
          cacheItem: [lastTime, iterResult],
          ...sizeEstimates,
        };
        pendingIterResults.push(pendingItem);
        if (args.writeSpill && iterResult.type === "message-event") {
          const estimatedBytes = pendingItem.persistedSizeInBytes;
          if (
            pendingSpillMessages.length > 0 &&
            (pendingSpillMessages.length >= MAX_SPILL_MESSAGES_BEFORE_APPEND ||
              pendingSpillEstimatedBytes + estimatedBytes > MAX_SPILL_BYTES_PER_IDB_TRANSACTION)
          ) {
            await flushPendingSpillMessages();
          }
          pendingSpillMessages.push({
            message: iterResult.msgEvent as MessageEvent,
            estimatedSizeInBytes: estimatedBytes,
          });
          pendingSpillEstimatedBytes += estimatedBytes;
          if (
            pendingSpillMessages.length >= MAX_SPILL_MESSAGES_BEFORE_APPEND ||
            pendingSpillEstimatedBytes >= MAX_SPILL_BYTES_PER_IDB_TRANSACTION
          ) {
            await flushPendingSpillMessages();
          }
        }

        if (args.writeSpill && iterResult.type === "stamp") {
          const spillRangeEnd =
            compare(iterResult.stamp, args.end) > 0 ? args.end : iterResult.stamp;
          if (!sourceHadProblemInRange && compare(spillRangeStart, spillRangeEnd) <= 0) {
            await flushPendingSpillMessages();
            if (spillRangeWritesComplete) {
              await this.#recordSpillLoadedRange(
                spillRangeStart,
                spillRangeEnd,
                spillRangeStore,
                spillRangeContentRevision,
                args.topicGeneration,
                args.topicFingerprint,
              );
            }
          }
          sourceHadProblemInRange = false;
          spillRangeStart = add(spillRangeEnd, { sec: 0, nsec: 1 });
          spillRangeStore = this.#spillStore;
          if (
            spillRangeStore != undefined &&
            !this.#isCurrentSpillContext(
              spillRangeStore,
              args.topicGeneration,
              args.topicFingerprint,
            )
          ) {
            spillRangeStore = undefined;
          }
          spillRangeContentRevision = spillRangeStore?.getContentRevision();
          spillRangeWritesComplete = spillRangeStore != undefined;
        }

        yield iterResult;
      }
    } catch (error) {
      if (isAborted(args.abortSignal) && isAbortError(error)) {
        discardPendingIterResults();
        discardPendingSpillMessages();
        return false;
      }
      throw error;
    }

    if (isAborted(args.abortSignal)) {
      discardPendingIterResults();
      discardPendingSpillMessages();
      return false;
    }

    if (!this.#isCurrentTopicGeneration(args.topicGeneration)) {
      pendingIterResults.length = 0;
      discardPendingSpillMessages();
      return true;
    }

    // We've finished reading our source to the end, close out the block
    if (block) {
      block.end = args.end;

      // update the last time this block was accessed
      block.lastAccess = Date.now();

      // write any pending messages to the block
      for (const pendingItem of pendingIterResults) {
        block.items.push(pendingItem.cacheItem);
        block.size += pendingItem.memorySizeInBytes;
      }

      this.#recomputeLoadedRangeCache();
    } else {
      // We don't have a block after finishing our source. This can happen if the last
      // thing we read in the source made our block be over size and we cycled to a new block.
      // This can also happen if there were no messages in our source range.
      //
      // Since we never loop again we need to insert an empty block from the readHead
      // to sourceReadEnd because we know there's nothing else in that range.
      const newBlock: CacheBlock<MessageType> = {
        id: this.#nextBlockId++,
        start: readHead,
        end: args.end,
        items: pendingIterResults.map((item) => item.cacheItem),
        size: 0,
        lastAccess: Date.now(),
      };

      for (const pendingItem of pendingIterResults) {
        newBlock.size += pendingItem.memorySizeInBytes;
      }

      // Find where we need to insert our new block.
      // It should come before any blocks with a start time > than new block start time.
      const insertIndex = _.sortedIndexBy(this.#cache, newBlock, (item) => toNanoSec(item.start));
      this.#cache.splice(insertIndex, 0, newBlock);

      this.#recomputeLoadedRangeCache();
    }

    if (args.writeSpill) {
      await flushPendingSpillMessages();
      if (
        spillRangeWritesComplete &&
        !sourceHadProblemInRange &&
        compare(spillRangeStart, args.end) <= 0
      ) {
        await this.#recordSpillLoadedRange(
          spillRangeStart,
          args.end,
          spillRangeStore,
          spillRangeContentRevision,
          args.topicGeneration,
          args.topicFingerprint,
        );
      }
    }
    return true;
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<MessageType>>> {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    const maxEnd = args.end ?? this.#initResult.end;
    const maxEndNanos = toNanoSec(maxEnd);

    const iteratorTopics = new Map(args.topics);
    const iteratorTopicFingerprint = topicFingerprint(iteratorTopics);
    const iteratorTopicGeneration = await this.#resetForTopicsIfNeeded(iteratorTopics);

    // Where we want to read messages from. As we move through blocks and messages, the read head
    // moves forward to track the next place we should be reading.
    let readHead = args.start ?? this.#initResult.start;

    if (args.fetchCompleteTopicState === "complete") {
      if (isAborted(args.abortSignal)) {
        return;
      }
      try {
        yield* this.#source.messageIterator({
          topics: iteratorTopics,
          start: readHead,
          end: maxEnd,
          consumptionType: args.consumptionType,
          fetchCompleteTopicState: args.fetchCompleteTopicState,
          abortSignal: args.abortSignal,
        });
      } catch (error) {
        if (isAborted(args.abortSignal) && isAbortError(error)) {
          return;
        }
        throw error;
      }
      return;
    }

    const findIndexContainingPredicate = (item: CacheBlock<MessageType>) => {
      return compare(item.start, readHead) <= 0 && compare(item.end, readHead) >= 0;
    };

    const findAfterPredicate = (item: CacheBlock<MessageType>) => {
      // Find the first index where readHead is less than an existing start
      return compare(readHead, item.start) < 0;
    };

    this.#currentReadHead = readHead;

    // Compute evictable block candiates such that canReadMore() returns a correct result as the
    // callee may stop iterating when canReadMore() returns false.
    this.#evictableBlockCandidates = this.#findEvictableBlockCandidates(this.#currentReadHead);

    for (;;) {
      if (compare(readHead, maxEnd) > 0) {
        break;
      }

      if (!this.#isCurrentTopicGeneration(iteratorTopicGeneration)) {
        try {
          yield* this.#source.messageIterator({
            topics: iteratorTopics,
            start: readHead,
            end: maxEnd,
            consumptionType: args.consumptionType,
            fetchCompleteTopicState: args.fetchCompleteTopicState,
            abortSignal: args.abortSignal,
          });
        } catch (error) {
          if (isAborted(args.abortSignal) && isAbortError(error)) {
            return;
          }
          throw error;
        }
        return;
      }

      const cacheBlockIndex = this.#cache.findIndex(findIndexContainingPredicate);

      let block = this.#cache[cacheBlockIndex];

      // if the block start === end and done is false, then it could have been a new block we started but never
      // got around to adding any messages into, we remove it.
      if (block && compare(block.start, block.end) === 0 && block.items.length === 0) {
        block = undefined;
        this.#cache.splice(cacheBlockIndex, 1);
        continue;
      }

      // We've found a block containing our readHead, try reading items from the block
      if (block) {
        const cacheIndex = CachingIterableSource.#FindStartCacheItemIndex(
          block.items,
          toNanoSec(readHead),
        );

        // We have a cached item, we can consume our cache until we've read to the end
        for (let idx = cacheIndex; idx < block.items.length; ++idx) {
          const cachedItem = block.items[idx];
          if (!cachedItem) {
            break;
          }

          // We may have found a cached time that is after our max iterator time.
          // We bail with no return when that happens.
          if (cachedItem[0] > maxEndNanos) {
            return;
          }

          // update the last time this block was accessed
          block.lastAccess = Date.now();

          yield cachedItem[1];
        }

        // We've read all the messages cached for the block, this means our next read can start
        // at 1 nanosecond after the end of the block because we know that block.end is inclusive
        // of all the messages our block represents.
        readHead = add(block.end, { sec: 0, nsec: 1 });
        continue;
      }

      // We don't have a block for our readHead which meas we need to read from the source.
      // We start reading from the source where the readHead is. We end reading from the source
      // where the next block starts (or source.end if there is no next block)

      // The block (and source) will start at the read head
      const sourceReadStart = readHead;

      // Look for the block that comes after our read head
      const nextBlockIndex = this.#cache.findIndex(findAfterPredicate);

      // If we have a next block (this is the block ours would come before), then we only need
      // to read up to that block.
      const nextBlock = this.#cache[nextBlockIndex];

      let sourceReadEnd = nextBlock ? subtract(nextBlock.start, { sec: 0, nsec: 1 }) : maxEnd;

      if (compare(sourceReadStart, sourceReadEnd) > 0) {
        throw new Error("Invariant: sourceReadStart > sourceReadEnd");
      }

      // When reading for our message iterator, we might have a nextBlock that starts
      // after the end time we want to read. This limits our reading to the end time of the iterator.
      if (compare(sourceReadEnd, maxEnd) > 0) {
        sourceReadEnd = maxEnd;
      }

      if (!this.#hasActiveSpillCache(iteratorTopicGeneration, iteratorTopicFingerprint)) {
        const sourceRangeComplete = yield* this.#yieldSourceRange({
          start: sourceReadStart,
          end: sourceReadEnd,
          topics: iteratorTopics,
          consumptionType: args.consumptionType,
          fetchCompleteTopicState: args.fetchCompleteTopicState,
          abortSignal: args.abortSignal,
          writeSpill: false,
          topicGeneration: iteratorTopicGeneration,
          topicFingerprint: iteratorTopicFingerprint,
        });
        if (!sourceRangeComplete) {
          return;
        }
        readHead = add(sourceReadEnd, { sec: 0, nsec: 1 });
        continue;
      }

      const spillRanges = await this.#getSpillLoadedRanges(
        iteratorTopicGeneration,
        iteratorTopicFingerprint,
      );
      let segmentStart = sourceReadStart;
      while (compare(segmentStart, sourceReadEnd) <= 0) {
        let containingSpillRange: LoadedRange | undefined;
        for (const range of spillRanges) {
          if (compare(range.start, segmentStart) <= 0 && compare(range.end, segmentStart) >= 0) {
            containingSpillRange = range;
            break;
          }
        }

        if (containingSpillRange) {
          const segmentEnd =
            compare(containingSpillRange.end, sourceReadEnd) < 0
              ? containingSpillRange.end
              : sourceReadEnd;
          const spillIterator = this.#yieldSpillRange({
            start: segmentStart,
            end: segmentEnd,
            topics: iteratorTopics,
            topicGeneration: iteratorTopicGeneration,
            topicFingerprint: iteratorTopicFingerprint,
          });
          let spillReadResult: SpillRangeReadResult = { complete: true };
          for (;;) {
            const result = await spillIterator.next();
            if (result.done === true) {
              spillReadResult = result.value;
              break;
            }
            yield result.value;
          }
          if (!spillReadResult.complete) {
            let sourceRangeComplete: boolean;
            if (spillReadResult.directSource) {
              sourceRangeComplete = yield* this.#yieldSourceRangeDirect({
                start: spillReadResult.resumeFrom,
                end: segmentEnd,
                topics: iteratorTopics,
                consumptionType: args.consumptionType,
                fetchCompleteTopicState: args.fetchCompleteTopicState,
                abortSignal: args.abortSignal,
              });
            } else {
              sourceRangeComplete = yield* this.#yieldSourceRange({
                start: segmentStart,
                end: segmentEnd,
                topics: iteratorTopics,
                consumptionType: args.consumptionType,
                fetchCompleteTopicState: args.fetchCompleteTopicState,
                abortSignal: args.abortSignal,
                writeSpill: true,
                topicGeneration: iteratorTopicGeneration,
                topicFingerprint: iteratorTopicFingerprint,
              });
            }
            if (!sourceRangeComplete) {
              return;
            }
          }
          segmentStart = add(segmentEnd, { sec: 0, nsec: 1 });
          continue;
        }

        let nextSpillRange: LoadedRange | undefined;
        for (const range of spillRanges) {
          if (compare(range.start, segmentStart) > 0 && compare(range.start, sourceReadEnd) <= 0) {
            nextSpillRange = range;
            break;
          }
        }
        const segmentEnd = nextSpillRange
          ? subtract(nextSpillRange.start, { sec: 0, nsec: 1 })
          : sourceReadEnd;

        const sourceRangeComplete = yield* this.#yieldSourceRange({
          start: segmentStart,
          end: segmentEnd,
          topics: iteratorTopics,
          consumptionType: args.consumptionType,
          fetchCompleteTopicState: args.fetchCompleteTopicState,
          abortSignal: args.abortSignal,
          writeSpill: true,
          topicGeneration: iteratorTopicGeneration,
          topicFingerprint: iteratorTopicFingerprint,
        });
        if (!sourceRangeComplete) {
          return;
        }
        segmentStart = add(segmentEnd, { sec: 0, nsec: 1 });
      }

      // We've read everything there was to read for this source, so our next read will be after
      // the end of this source
      readHead = add(sourceReadEnd, { sec: 0, nsec: 1 });
    }
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<MessageType>[]> {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    const backfillTopics = new Map(args.topics);
    const backfillTopicFingerprint = topicFingerprint(backfillTopics);
    const backfillTopicGeneration = await this.#resetForTopicsIfNeeded(backfillTopics);

    // Find a block that contains args.time. We must find a block that contains args.time rather
    // than one that occurs anytime before args.time to correctly get the last message before
    // args.time rather than any message that occurs before args.time.
    const cacheBlockIndex = this.#cache.findIndex((item) => {
      return compare(item.start, args.time) <= 0 && compare(item.end, args.time) >= 0;
    });

    const out: MessageEvent<MessageType>[] = [];
    const needsTopics = new Map(backfillTopics);

    // Starting at the block we found for args.time, work backwards through blocks until:
    // * we've loaded all the topics
    // * we have a gap between our block and the previous block
    //
    // We must stop going backwards when we have a gap because we can no longer know if the source
    // actually does have messages in the gap.
    for (let idx = cacheBlockIndex; idx >= 0 && needsTopics.size > 0; --idx) {
      const cacheBlock = this.#cache[idx];
      if (!cacheBlock) {
        break;
      }

      const targetTime = toNanoSec(args.time);
      let readIdx = sortedIndexByTuple(cacheBlock.items, targetTime);

      // If readIdx is negative then we don't have an exact match, but readIdx does tell us what that is
      // See the findCacheItem documentation for how to interpret it.
      if (readIdx < 0) {
        readIdx = ~readIdx;

        // readIdx will point to the element after our time (or 1 past the end of the array)
        // We subtract 1 to start reading from before that element or end of array
        readIdx -= 1;
      } else {
        // When readIdx is an exact match we get a positive value. For an exact match we traverse
        // forward linearly to find the last occurrence of the matching timestamp in our cache
        // block. We can then read backwards in the block to find the last messages on all requested
        // topics.
        for (let i = readIdx + 1; i < cacheBlock.items.length; ++i) {
          if (cacheBlock.items[i]?.[0] !== targetTime) {
            break;
          }
          readIdx = i;
        }
      }

      for (let i = readIdx; i >= 0; --i) {
        const record = cacheBlock.items[i];
        if (!record || record[1].type !== "message-event") {
          continue;
        }

        const msgEvent = record[1].msgEvent;
        if (needsTopics.has(msgEvent.topic)) {
          needsTopics.delete(msgEvent.topic);
          out.push(msgEvent);
        }
      }

      const prevBlock = this.#cache[idx - 1];
      // If we have a gap between the start of our block and the previous block, then we must stop
      // trying to read from the block cache
      if (prevBlock && compare(add(prevBlock.end, { sec: 0, nsec: 1 }), cacheBlock.start) !== 0) {
        break;
      }
    }

    // If we found all our topics from our cache then we don't need to fallback to the source
    if (needsTopics.size === 0) {
      return out;
    }

    const spillBackfill = await this.#readSpillBackfillMessages(
      {
        ...args,
        topics: needsTopics,
      },
      backfillTopicGeneration,
      backfillTopicFingerprint,
    );
    for (const message of spillBackfill) {
      if (!needsTopics.has(message.topic)) {
        continue;
      }
      needsTopics.delete(message.topic);
      out.push(message as MessageEvent<MessageType>);
    }

    if (needsTopics.size === 0) {
      out.sort((a, b) => compare(a.receiveTime, b.receiveTime));
      return out;
    }

    // fallback to the source for any topics we weren't able to load
    const sourceBackfill = await this.#source.getBackfillMessages({
      ...args,
      topics: needsTopics,
    });

    out.push(...sourceBackfill);
    out.sort((a, b) => compare(a.receiveTime, b.receiveTime));

    return out;
  }

  #recomputeLoadedRangeCache(): void {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    // The nanosecond time of the start of the source
    const sourceStartNs = toNanoSec(this.#initResult.start);

    const rangeNs = Number(toNanoSec(subtract(this.#initResult.end, this.#initResult.start)));
    if (rangeNs === 0) {
      this.#loadedRangesCache = [{ start: 0, end: 1 }];
      this.emit("loadedRangesChange");
      return;
    }

    if (this.#cache.length === 0 && this.#spillLoadedRanges.length === 0) {
      this.#loadedRangesCache = [{ start: 0, end: 0 }];
      this.emit("loadedRangesChange");
      return;
    }

    // Merge continuous ranges (i.e. a block that starts 1 nanosecond after previous ends)
    // This avoids float rounding errors when computing loadedRangesCache and produces
    // continuous ranges for continuous spans
    const ranges: { start: number; end: number }[] = [];
    let prevRange: { start: bigint; end: bigint } | undefined;
    const rangesNs = [
      ...this.#cache.map((block) => ({
        start: toNanoSec(block.start),
        end: toNanoSec(block.end),
      })),
      ...this.#spillLoadedRanges.map((range) => ({
        start: toNanoSec(range.start),
        end: toNanoSec(range.end),
      })),
    ].sort((a, b) => {
      if (a.start < b.start) {
        return -1;
      }
      if (a.start > b.start) {
        return 1;
      }
      return 0;
    });

    for (const range of rangesNs) {
      if (!prevRange) {
        prevRange = range;
      } else if (prevRange.end + 1n >= range.start) {
        prevRange.end = prevRange.end > range.end ? prevRange.end : range.end;
      } else {
        ranges.push({
          start: Number(prevRange.start - sourceStartNs) / rangeNs,
          end: Number(prevRange.end - sourceStartNs) / rangeNs,
        });
        prevRange = range;
      }
    }
    if (prevRange) {
      ranges.push({
        start: Number(prevRange.start - sourceStartNs) / rangeNs,
        end: Number(prevRange.end - sourceStartNs) / rangeNs,
      });
    }

    this.#loadedRangesCache = ranges;
    this.emit("loadedRangesChange");
  }

  /**
   * Update the current read head, such that the source can determine which blocks are evictable.
   * @param readHead current read head
   */
  public setCurrentReadHead(readHead: Time): void {
    this.#currentReadHead = readHead;
  }

  /**
   * Checks if the current cache size allows reading more messages into the cache or if there are
   * blocks that can be evicted.
   * @returns True if more messages can be read, false otherwise.
   */
  public canReadMore(): boolean {
    if (this.#totalSizeBytes < this.#maxTotalSizeBytes) {
      // Still room for reading new messages from the source.
      return true;
    }

    return this.#evictableBlockCandidates.length > 0;
  }

  /**
   * Determines which cache blocks can be evicted. A cache block is evictable, if
   * - its end time is before the given readHead
   * - it is not part of the continuous block chain starting from the block that contains
   *   the given readHead
   * @param readHead current read head
   * @returns A list of evictable blocks (ordered by most evictable first) or an empty list
   * if there is no evictable block.
   */
  #findEvictableBlockCandidates(readHead: Time): CacheBlock<MessageType>["id"][] {
    if (this.#cache.length === 0) {
      return [];
    }

    // Create a light, mutable copy of the current cache.
    const mappedCache = this.#cache.map((block) => ({
      id: block.id,
      start: block.start,
      end: block.end,
    }));
    // Sort blocks by time (earlier blocks first).
    mappedCache.sort((a, b) => compare(a.end, b.end));
    // Find the index of the block that contains the current read head.
    const readHeadIdx = mappedCache.findIndex(
      (block) => compare(block.start, readHead) <= 0 && compare(block.end, readHead) >= 0,
    );

    if (readHeadIdx === -1) {
      // No block contains current read head, return the oldest cache block.
      // This can only happen when seeked to a new time and no message has been read yet, as
      // reading a new message that does not fit in any block will always create a new cache block.
      const oldestBlockIdx = minIndexBy(this.#cache, (a, b) => a.lastAccess - b.lastAccess);
      const oldestBlock = this.#cache[oldestBlockIdx];
      if (!oldestBlock) {
        // This should never happen as the cache is not empty and the index is valid.
        throw new Error("Failed to retrieve oldest block from cache");
      }
      return [oldestBlock.id];
    }

    // Blocks that are before the read head can be evicted.
    const blockIdsBeforeReadHead = mappedCache.splice(0, readHeadIdx).map((item) => item.id);

    // Iterate through remaining blocks until we find a gap in the block chain
    let prevEnd: bigint | undefined;
    let idx = 0;
    for (idx = 0; idx < mappedCache.length; ++idx) {
      const block = mappedCache[idx]!;
      const start = toNanoSec(block.start);
      const end = toNanoSec(block.end);
      if (prevEnd == undefined || prevEnd + 1n === start) {
        prevEnd = end;
      } else {
        break;
      }
    }

    // All blocks that are not part of the first block chain can be considered evictable.
    const blockIdsAfterGap = mappedCache.splice(idx).map((item) => item.id);

    return [
      ...blockIdsBeforeReadHead,
      ...blockIdsAfterGap.reverse(), // Reverse order (furthest away from read head first)
    ];
  }

  // Attempt to purge a cache block if adding sizeInBytes to the cache would exceed the maxTotalSizeBytes
  // @return true if a block was purged
  //
  // Throws if the cache block we want to purge is the active block.
  #maybePurgeCache(opt: { activeBlock?: CacheBlock<MessageType>; sizeInBytes: number }): boolean {
    const { activeBlock, sizeInBytes } = opt;

    // Determine if our total size would exceed max and purge the oldest block
    if (this.#totalSizeBytes + sizeInBytes <= this.#maxTotalSizeBytes) {
      return false;
    }

    // Find evictable block candidates
    this.#evictableBlockCandidates = this.#findEvictableBlockCandidates(this.#currentReadHead);
    if (this.#evictableBlockCandidates.length === 0) {
      return false;
    }

    // Evict the first evictable candidate
    const blockId = this.#evictableBlockCandidates.splice(0, 1)[0];
    const idx = this.#cache.findIndex((item) => item.id === blockId);
    const block = this.#cache[idx];
    if (block) {
      if (block === activeBlock) {
        throw new Error("Cannot evict the active cache block.");
      }
      this.#totalSizeBytes -= block.size;
      this.#cache.splice(idx, 1);
      return true;
    }

    return false;
  }

  static #FindStartCacheItemIndex(items: [bigint, IteratorResult][], key: bigint) {
    // A common case is to access consecutive blocks during playback. In that case, we expect to
    // read from the first item in the block. We check this special case first to avoid a binary
    // search if we are able to find the key in the first item.
    if (items[0] != undefined && items[0][0] >= key) {
      return 0;
    }

    let idx = sortedIndexByTuple(items, key);
    if (idx < 0) {
      return ~idx;
    }

    // An exact match just means we've found a matching item, not necessarily the first or last
    // matching item. We want the first item so we linearly iterate backwards until we no longer have
    // a match.
    for (let i = idx - 1; i >= 0; --i) {
      const prevItem = items[i];
      if (prevItem != undefined && prevItem[0] !== key) {
        break;
      }
      idx = i;
    }

    return idx;
  }
}

export { CachingIterableSource };
