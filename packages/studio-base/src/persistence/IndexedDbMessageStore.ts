// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import Log from "@foxglove/log";
import { isGreaterThan } from "@foxglove/rostime";
import type { MessageEvent, Time } from "@foxglove/studio";
import { OptionalMessageDefinition, RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import type { PersistentMessageCache } from "./PersistentMessageCache";

const log = Log.getLogger(__filename);

const DB_NAME = "studio-realtime-cache";
const STORE = "messages";
const DATATYPES_STORE = "datatypes";
const SESSIONS_STORE = "sessions";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

type StoredMessageEvent = Omit<MessageEvent, "originalMessageEvent"> & {
  // internal fields for indexing and tiebreak
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
    key: string; // sessionId
    value: {
      sessionId: string;
      datatypes: Record<string, OptionalMessageDefinition>;
      timestamp: number;
    };
  };
  [SESSIONS_STORE]: {
    key: string; // sessionId
    value: {
      sessionId: string;
      createdAt: number; // timestamp when session was created
      lastActiveAt: number; // timestamp of last activity
    };
  };
}

function sanitizeEvent(sessionId: string, seq: number, event: MessageEvent): StoredMessageEvent {
  // Drop potential cycles
  const { originalMessageEvent: _drop, ...rest } = event;
  return { ...rest, sessionId, seq };
}

// Get current storage usage using Storage API
async function getCurrentStorageUsage(): Promise<number> {
  try {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage ?? 0;
    }
  } catch (error) {
    log.warn("Failed to get storage estimate, falling back to 0:", error);
  }
  return 0;
}

interface IndexedDbMessageStoreOptions {
  /** Retention window in milliseconds (default: 5 minutes) */
  retentionWindowMs?: number;
  /** Custom session ID (default: auto-generated) */
  sessionId?: string;
  /** Max cache size in bytes (default: 25GB) */
  maxCacheSize?: number;
}

export class IndexedDbMessageStore implements PersistentMessageCache {
  #dbPromise: Promise<IDB.IDBPDatabase<MessagesDB>>;
  #retentionWindowMs: number;
  #maxCacheSize: number;
  #seqBySession = new Map<string, number>();
  #currentSessionId: string;
  #initialized = false;
  #lastPruneTime?: number;
  #pruneIntervalMs: number = 30 * 1000; // Prune every 30 seconds
  #messageCount = 0;

  public constructor(options: IndexedDbMessageStoreOptions = {}) {
    const {
      retentionWindowMs = 5 * 60 * 1000, // 5 minutes default
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      maxCacheSize = 25 * 1024 * 1024 * 1024, // 25GB default
    } = options;

    this.#retentionWindowMs = retentionWindowMs;
    this.#maxCacheSize = maxCacheSize;
    this.#currentSessionId = sessionId;

    console.debug("debug open db", DB_NAME, sessionId);
    this.#dbPromise = IDB.openDB<MessagesDB>(DB_NAME, 1, {
      upgrade(db) {
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
        db.createObjectStore(DATATYPES_STORE, {
          keyPath: "sessionId",
        });
        db.createObjectStore(SESSIONS_STORE, {
          keyPath: "sessionId",
        });
      },
    });

    void this.#dbPromise
      .then(async () => {
        // Clean up old sessions (older than 3 days) before initializing current session
        await this.#cleanupOldSessions();

        // Record current session creation time
        await this.#recordSessionCreation();

        // Calculate existing message count if not clearing on init
        await this.#calculateExistingMessageCount();

        this.#initialized = true;
        log.info(`IndexedDbMessageStore initialized with session: ${this.#currentSessionId}`);
      })
      .catch((error: unknown) => {
        log.error("Failed to initialize IndexedDbMessageStore:", error);
      });
  }

  // Calculate the count of existing messages
  async #calculateExistingMessageCount(): Promise<void> {
    try {
      const db = await this.#dbPromise;
      const tx = db.transaction(STORE, "readonly");
      const index = tx.store.index("bySession");

      // Use IndexedDB count method for better performance
      const messageCount = await index.count(this.#currentSessionId);
      await tx.done;

      this.#messageCount = messageCount;

      log.debug(`Calculated existing message count: ${messageCount} messages`);
    } catch (error) {
      log.error("Failed to calculate existing message count:", error);
    }
  }

  // Record current session creation time
  async #recordSessionCreation(): Promise<void> {
    try {
      const db = await this.#dbPromise;
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);

      const now = Date.now();
      await store.put({
        sessionId: this.#currentSessionId,
        createdAt: now,
        lastActiveAt: now,
      });
      await tx.done;

      log.debug(
        `Recorded session creation: ${this.#currentSessionId} at ${new Date(now).toISOString()}`,
      );
    } catch (error) {
      log.error("Failed to record session creation:", error);
    }
  }

  // Clean up sessions older than 3 days
  async #cleanupOldSessions(): Promise<void> {
    const cutoffTime = Date.now() - THREE_DAYS_MS;

    try {
      const db = await this.#dbPromise;

      // Get all old sessions
      const sessionsTx = db.transaction(SESSIONS_STORE, "readonly");
      const sessionsStore = sessionsTx.objectStore(SESSIONS_STORE);
      const oldSessions: string[] = [];

      for await (const cursor of sessionsStore.iterate()) {
        const session = cursor.value;
        if (session.createdAt < cutoffTime) {
          oldSessions.push(session.sessionId);
        }
      }
      await sessionsTx.done;

      if (oldSessions.length === 0) {
        log.debug("No old sessions to clean up");
        return;
      }

      log.info(`Cleaning up ${oldSessions.length} sessions older than 3 days`);

      // Clean up old sessions data
      for (const sessionId of oldSessions) {
        await this.#cleanupSessionData(sessionId);
      }

      log.info(`Successfully cleaned up ${oldSessions.length} old sessions`);
    } catch (error) {
      log.error("Failed to cleanup old sessions:", error);
    }
  }

  // Clean up all data for a specific session
  async #cleanupSessionData(sessionId: string): Promise<void> {
    try {
      const db = await this.#dbPromise;
      const tx = db.transaction([STORE, DATATYPES_STORE, SESSIONS_STORE], "readwrite");

      // Clean up messages
      const messageStore = tx.objectStore(STORE);
      const messageIndex = messageStore.index("bySession");
      for await (const cursor of messageIndex.iterate(sessionId)) {
        await cursor.delete();
      }

      // Clean up datatypes
      const datatypesStore = tx.objectStore(DATATYPES_STORE);
      await datatypesStore.delete(sessionId);

      // Clean up session record
      const sessionsStore = tx.objectStore(SESSIONS_STORE);
      await sessionsStore.delete(sessionId);

      await tx.done;
      log.debug(`Cleaned up all data for session: ${sessionId}`);
    } catch (error) {
      log.error(`Failed to cleanup session data for ${sessionId}:`, error);
    }
  }

  public async init(): Promise<void> {
    await this.#dbPromise;
    // Wait for initialization to complete
    while (!this.#initialized) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  public getSessionId(): string {
    return this.#currentSessionId;
  }

  public getRetentionWindowMs(): number {
    return this.#retentionWindowMs;
  }

  public setRetentionWindowMs(durationMs: number): void {
    this.#retentionWindowMs = durationMs;
  }

  public getMaxCacheSize(): number {
    return this.#maxCacheSize;
  }

  public setMaxCacheSize(sizeBytes: number): void {
    this.#maxCacheSize = sizeBytes;
  }

  public async waitForInit(): Promise<void> {
    await this.init();
  }

  public async append(events: readonly MessageEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction([STORE, SESSIONS_STORE], "readwrite");
    const store = tx.objectStore(STORE);
    const sessionsStore = tx.objectStore(SESSIONS_STORE);

    const sessionId = this.#currentSessionId;
    let seq = this.#seqBySession.get(sessionId) ?? 0;
    let latestTime: Time | undefined;

    for (const ev of events) {
      latestTime =
        latestTime == undefined || isGreaterThan(ev.receiveTime, latestTime)
          ? ev.receiveTime
          : latestTime;
      const value = sanitizeEvent(sessionId, seq++, ev);
      await store.put(value);
    }
    this.#seqBySession.set(sessionId, seq);

    this.#messageCount += events.length;

    // Update session last active time
    try {
      const sessionData = await sessionsStore.get(sessionId);
      if (sessionData) {
        sessionData.lastActiveAt = Date.now();
        await sessionsStore.put(sessionData);
      }
    } catch (error) {
      // Don't fail the append if session update fails
      log.debug("Failed to update session lastActiveAt:", error);
    }

    await tx.done;

    // Pruning - check both retention window and cache size limits
    // Use interval-based pruning to avoid pruning on every append for performance
    const now = Date.now();
    const shouldPrune =
      this.#lastPruneTime == undefined || now - this.#lastPruneTime >= this.#pruneIntervalMs;

    if (latestTime != undefined && shouldPrune) {
      try {
        // Check current storage usage
        const currentStorageUsage = await getCurrentStorageUsage();
        const isCacheSizeExceeded = currentStorageUsage > this.#maxCacheSize;

        let totalPrunedCount = 0;

        // Time-based pruning
        const cutoffDate = new Date(
          latestTime.sec * 1000 + Math.floor(latestTime.nsec / 1e6) - this.#retentionWindowMs,
        );
        const cutoff: Time = {
          sec: Math.floor(cutoffDate.getTime() / 1000),
          nsec: (cutoffDate.getTime() % 1000) * 1e6,
        };

        totalPrunedCount += await this.#pruneBeforeTime(this.#currentSessionId, cutoff);

        // If cache size is still exceeded after time-based pruning, do size-based pruning
        if (isCacheSizeExceeded) {
          const currentStorageAfterTimePrune = await getCurrentStorageUsage();
          if (currentStorageAfterTimePrune > this.#maxCacheSize) {
            totalPrunedCount += await this.#pruneOldestUntilSize(
              this.#currentSessionId,
              this.#maxCacheSize * 0.9, // Prune to 90% of max to avoid frequent pruning
            );
          }
        }

        // Update counters
        this.#messageCount -= totalPrunedCount;
        this.#lastPruneTime = now;

        if (totalPrunedCount > 0) {
          const finalStorageUsage = await getCurrentStorageUsage();
          log.debug(
            `Pruned ${totalPrunedCount} messages, storage usage: ${Math.round(
              finalStorageUsage / 1024 / 1024,
            )}MB (limit: ${Math.round(this.#maxCacheSize / 1024 / 1024)}MB)`,
          );
        }
      } catch (err) {
        log.debug("append: pruning failed", err);
      }
    }
  }

  // Remove data before cutoff time and return count
  async #pruneBeforeTime(sessionId: string, cutoff: Time): Promise<number> {
    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.store.index("bySessionTime");
    const upper = IDBKeyRange.upperBound([sessionId, cutoff.sec, cutoff.nsec], true);

    let deletedCount = 0;

    for await (const cursor of index.iterate(upper)) {
      await cursor.delete();
      deletedCount++;
    }

    await tx.done;
    return deletedCount;
  }

  // Remove oldest messages until storage usage is under target
  async #pruneOldestUntilSize(sessionId: string, targetSize: number): Promise<number> {
    let totalDeletedCount = 0;
    const BATCH_SIZE = 100; // Delete messages in batches to avoid blocking

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const db = await this.#dbPromise;
      const tx = db.transaction(STORE, "readwrite");
      const index = tx.store.index("bySessionTime");
      const range = IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      );

      let batchDeletedCount = 0;

      // Delete a batch of messages
      for await (const cursor of index.iterate(range)) {
        await cursor.delete();
        batchDeletedCount++;
        if (batchDeletedCount >= BATCH_SIZE) {
          break;
        }
      }

      await tx.done;
      totalDeletedCount += batchDeletedCount;

      // If no messages were deleted in this batch, we're done
      if (batchDeletedCount === 0) {
        break;
      }

      // Check if we've reached the target size
      const currentStorageUsage = await getCurrentStorageUsage();
      if (currentStorageUsage <= targetSize) {
        break;
      }
    }

    return totalDeletedCount;
  }

  public async getMessages(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    limit?: number;
  }): Promise<readonly MessageEvent[]> {
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
        cursor.continue();
        continue;
      }
      out.push(value as unknown as MessageEvent);
      if (limit != undefined && out.length >= limit) {
        break;
      }
      cursor.continue();
    }
    await tx.done;
    return out;
  }

  public async getBackfillMessages(params: {
    time: Time;
    topics: readonly string[];
  }): Promise<readonly MessageEvent[]> {
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
          // crossed out of range due to upperBound on composite; break
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
    await this.#cleanupSessionData(this.#currentSessionId);
    this.#seqBySession.delete(this.#currentSessionId);
    this.#messageCount = 0; // Reset message count for current session
  }

  public async clearAll(): Promise<void> {
    const db = await this.#dbPromise;
    const tx = db.transaction([STORE, DATATYPES_STORE, SESSIONS_STORE], "readwrite");
    await tx.objectStore(STORE).clear();
    await tx.objectStore(DATATYPES_STORE).clear();
    await tx.objectStore(SESSIONS_STORE).clear();
    await tx.done;
    this.#seqBySession.clear();
    this.#messageCount = 0;
    this.#lastPruneTime = undefined;
  }

  public async close(): Promise<void> {
    const db = await this.#dbPromise;
    console.debug("debug close db", DB_NAME, this.#currentSessionId);
    db.close();
  }

  public async stats(): Promise<{
    count: number;
    earliest?: Time;
    latest?: Time;
    approximateSizeBytes?: number;
  }> {
    const sessionId = this.#currentSessionId;
    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readonly");
    const index = tx.store.index("bySessionTime");
    const lower = IDBKeyRange.lowerBound([
      sessionId,
      Number.MIN_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ]);
    const upper = IDBKeyRange.upperBound([
      sessionId,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]);

    let earliest: Time | undefined;
    let latest: Time | undefined;
    let count = 0;

    // earliest
    for await (const cursor of index.iterate(lower)) {
      if (cursor.value.sessionId === sessionId) {
        earliest = cursor.value.receiveTime;
      }
      break;
    }

    // latest
    for await (const cursor of index.iterate(upper, "prev")) {
      if (cursor.value.sessionId === sessionId) {
        latest = cursor.value.receiveTime;
      }
      break;
    }

    // count (may be expensive for large sets; acceptable for short retention)
    count = await index.count(
      IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ),
    );

    await tx.done;
    const storageUsage = await getCurrentStorageUsage();
    return { count, earliest, latest, approximateSizeBytes: storageUsage };
  }

  /**
   * Get detailed window statistics for monitoring the 5-minute sliding window
   */
  public async getWindowStats(): Promise<{
    retentionWindowMs: number;
    messageCount: number;
    windowUtilization: number; // Percentage of window filled with data
    oldestMessage?: Time;
    newestMessage?: Time;
    cacheSize: {
      approximateSizeBytes: number;
      maxCacheSize: number;
      sizeUtilization: number; // Percentage of max cache size used
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
    const currentStorageUsage = await getCurrentStorageUsage();
    const sizeUtilization = (currentStorageUsage / this.#maxCacheSize) * 100;

    return {
      retentionWindowMs: this.#retentionWindowMs,
      messageCount: this.#messageCount,
      windowUtilization,
      oldestMessage: stats.earliest,
      newestMessage: stats.latest,
      cacheSize: {
        approximateSizeBytes: currentStorageUsage,
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

  /**
   * Force immediate pruning of old data (useful for testing or manual cleanup)
   */
  public async forcePrune(): Promise<{
    prunedCount: number;
    newCount: number;
    initialStorageBytes: number;
    finalStorageBytes: number;
  }> {
    const now = Date.now();
    const initialStorage = await getCurrentStorageUsage();
    const cutoffDate = new Date(now - this.#retentionWindowMs);
    const cutoff: Time = {
      sec: Math.floor(cutoffDate.getTime() / 1000),
      nsec: (cutoffDate.getTime() % 1000) * 1e6,
    };

    let totalPrunedCount = 0;

    // First, do time-based pruning
    totalPrunedCount += await this.#pruneBeforeTime(this.#currentSessionId, cutoff);

    // Then, if cache size is still exceeded, do size-based pruning
    const storageAfterTimePrune = await getCurrentStorageUsage();
    if (storageAfterTimePrune > this.#maxCacheSize) {
      totalPrunedCount += await this.#pruneOldestUntilSize(
        this.#currentSessionId,
        this.#maxCacheSize * 0.9, // Prune to 90% of max
      );
    }

    this.#messageCount -= totalPrunedCount;
    this.#lastPruneTime = now;

    const finalStorage = await getCurrentStorageUsage();

    log.info(
      `Force pruned ${totalPrunedCount} messages, storage: ${Math.round(
        initialStorage / 1024 / 1024,
      )}MB → ${Math.round(finalStorage / 1024 / 1024)}MB, ${this.#messageCount} messages remaining`,
    );

    return {
      prunedCount: totalPrunedCount,
      newCount: this.#messageCount,
      initialStorageBytes: initialStorage,
      finalStorageBytes: finalStorage,
    };
  }

  /**
   * Configure the pruning interval for performance tuning
   */
  public setPruneInterval(intervalMs: number): void {
    this.#pruneIntervalMs = Math.max(1000, intervalMs); // Minimum 1 second
  }

  /**
   * Store datatypes information for this session
   */
  public async storeDatatypes(datatypes: RosDatatypes): Promise<void> {
    const db = await this.#dbPromise;
    const tx = db.transaction(DATATYPES_STORE, "readwrite");
    const store = tx.objectStore(DATATYPES_STORE);

    // Convert Map to plain object for storage
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

  /**
   * Retrieve datatypes information for this session
   */
  public async getDatatypes(): Promise<RosDatatypes | undefined> {
    const db = await this.#dbPromise;
    const tx = db.transaction(DATATYPES_STORE, "readonly");
    const store = tx.objectStore(DATATYPES_STORE);

    const result = await store.get(this.#currentSessionId);
    await tx.done;

    if (!result) {
      return undefined;
    }

    // Convert plain object back to Map
    const datatypes = new Map<string, OptionalMessageDefinition>();
    for (const [key, value] of Object.entries(result.datatypes)) {
      datatypes.set(key, value);
    }

    return datatypes;
  }
}
