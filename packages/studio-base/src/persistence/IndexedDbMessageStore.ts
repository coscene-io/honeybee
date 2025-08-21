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
}

function sanitizeEvent(sessionId: string, seq: number, event: MessageEvent): StoredMessageEvent {
  // Drop potential cycles
  const { originalMessageEvent: _drop, ...rest } = event as MessageEvent & {
    originalMessageEvent?: MessageEvent | undefined;
  };
  return { ...rest, sessionId, seq } as StoredMessageEvent;
}

interface IndexedDbMessageStoreOptions {
  /** Retention window in milliseconds (default: 5 minutes) */
  retentionWindowMs?: number;
  /** Whether to auto-clear all data on initialization (default: true) */
  autoClearOnInit?: boolean;
  /** Custom session ID (default: auto-generated) */
  sessionId?: string;
}

export class IndexedDbMessageStore implements PersistentMessageCache {
  #dbPromise: Promise<IDB.IDBPDatabase<MessagesDB>>;
  #retentionWindowMs: number;
  #seqBySession = new Map<string, number>();
  #currentSessionId: string;
  #initialized = false;
  #lastPruneTime?: number;
  #pruneIntervalMs: number = 30 * 1000; // Prune every 30 seconds
  #messageCount = 0;

  public constructor(options: IndexedDbMessageStoreOptions = {}) {
    const {
      retentionWindowMs = 5 * 60 * 1000, // 5 minutes default
      autoClearOnInit = true,
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    } = options;

    this.#retentionWindowMs = retentionWindowMs;
    this.#currentSessionId = sessionId;

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
      },
    });

    if (autoClearOnInit) {
      // Auto-clear all data on initialization to ensure session isolation
      void this.#dbPromise
        .then(async () => {
          await this.clearAll();
          this.#initialized = true;
          log.info(`IndexedDbMessageStore initialized with session: ${this.#currentSessionId}`);
        })
        .catch((error: unknown) => {
          log.error("Failed to initialize IndexedDbMessageStore:", error);
        });
    } else {
      void this.#dbPromise.then(() => {
        this.#initialized = true;
      });
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

  public async waitForInit(): Promise<void> {
    await this.init();
  }

  public async append(events: readonly MessageEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

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

    // Retention pruning - always enabled with configured window
    // Use interval-based pruning to avoid pruning on every append for performance
    const now = Date.now();
    const shouldPrune =
      this.#lastPruneTime == undefined || now - this.#lastPruneTime >= this.#pruneIntervalMs;

    if (latestTime != undefined && shouldPrune) {
      try {
        const cutoffDate = new Date(
          latestTime.sec * 1000 + Math.floor(latestTime.nsec / 1e6) - this.#retentionWindowMs,
        );
        // Convert cutoff to Time
        const cutoff: Time = {
          sec: Math.floor(cutoffDate.getTime() / 1000),
          nsec: (cutoffDate.getTime() % 1000) * 1e6,
        };

        const prunedCount = await this.#pruneBefore(this.#currentSessionId, cutoff, tx);
        this.#messageCount -= prunedCount;
        this.#lastPruneTime = now;

        if (prunedCount > 0) {
          log.debug(`Pruned ${prunedCount} messages older than ${this.#retentionWindowMs}ms`);
        }
      } catch (err) {
        log.debug("append: retention prune failed", err);
      }
    }

    await tx.done;
  }

  async #pruneBefore(
    sessionId: string,
    cutoff: Time,
    existingTx?: IDB.IDBPTransaction<MessagesDB, ["messages"], "readwrite">,
  ): Promise<number> {
    const db = await this.#dbPromise;
    const tx = existingTx ?? db.transaction(STORE, "readwrite");
    const index = tx.store.index("bySessionTime");
    const upper = IDBKeyRange.upperBound([sessionId, cutoff.sec, cutoff.nsec], true);

    let deletedCount = 0;
    for await (const cursor of index.iterate(upper)) {
      await cursor.delete();
      deletedCount++;
    }

    if (existingTx == undefined) {
      await tx.done;
    }

    return deletedCount;
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
    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.store.index("bySession");
    const sessionId = this.#currentSessionId;

    let deletedCount = 0;
    for await (const cursor of index.iterate(sessionId)) {
      await cursor.delete();
      deletedCount++;
    }

    await tx.done;
    this.#seqBySession.delete(sessionId);
    this.#messageCount = Math.max(0, this.#messageCount - deletedCount);
  }

  public async clearAll(): Promise<void> {
    const db = await this.#dbPromise;
    const tx = db.transaction(STORE, "readwrite");
    await tx.store.clear();
    await tx.done;
    this.#seqBySession.clear();
    this.#messageCount = 0;
    this.#lastPruneTime = undefined;
  }

  public async close(): Promise<void> {
    const db = await this.#dbPromise;
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
    return { count, earliest, latest };
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

    return {
      retentionWindowMs: this.#retentionWindowMs,
      messageCount: this.#messageCount,
      windowUtilization,
      oldestMessage: stats.earliest,
      newestMessage: stats.latest,
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
  public async forcePrune(): Promise<{ prunedCount: number; newCount: number }> {
    const now = Date.now();
    const cutoffDate = new Date(now - this.#retentionWindowMs);
    const cutoff: Time = {
      sec: Math.floor(cutoffDate.getTime() / 1000),
      nsec: (cutoffDate.getTime() % 1000) * 1e6,
    };

    const prunedCount = await this.#pruneBefore(this.#currentSessionId, cutoff);
    this.#messageCount -= prunedCount;
    this.#lastPruneTime = now;

    log.info(`Force pruned ${prunedCount} messages, ${this.#messageCount} messages remaining`);

    return {
      prunedCount,
      newCount: this.#messageCount,
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
