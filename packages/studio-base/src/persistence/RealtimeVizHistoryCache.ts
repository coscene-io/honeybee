// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

import Log from "@foxglove/log";
import { isGreaterThan } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import type { RealtimeHistoryStatus, TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import {
  DEFAULT_APPEND_QUEUE_MAX_BYTES,
  DEFAULT_APPEND_QUEUE_MAX_MESSAGES,
  IndexedDbMessageStore,
  type MessageCacheMetricSink,
} from "./IndexedDbMessageStore";

const log = Log.getLogger(__filename);
const PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES = 256;
const RANGE_READ_TIMEOUT_MS = 5_000;
const RANGE_REFRESH_INTERVAL_MS = 1_000;

type ActiveRealtimeHistoryStatus = Exclude<RealtimeHistoryStatus, "disabled">;

export class RealtimeVizHistoryCache {
  #store: IndexedDbMessageStore;
  #disabled = false;
  #initialized = false;
  #latestTopics: readonly TopicWithDecodingInfo[] | undefined;
  #latestTopicStats: Map<string, TopicStats> | undefined;
  #latestDatatypes: RosDatatypes | undefined;
  #metadataWrites = new Set<Promise<void>>();
  #closePromise: Promise<void> | undefined;
  #closing = false;
  #pendingEvents: MessageEvent[] = [];
  #pendingEstimatedBytes = 0;
  #resetGeneration = 0;
  #resetPromise: Promise<void> | undefined;
  #status: ActiveRealtimeHistoryStatus = "initializing";
  #onStatusChange?: (status: ActiveRealtimeHistoryStatus) => void;
  #failure?: Error;
  #rangeRefreshTimer?: ReturnType<typeof setTimeout>;
  #rangeRefreshPromise?: Promise<void>;
  #persistedRangeVersion = 0;

  public constructor({
    sessionId,
    retentionWindowMs,
    maxCacheSize,
    metricSink,
    onStatusChange,
  }: {
    sessionId: string;
    retentionWindowMs: number;
    maxCacheSize?: number;
    metricSink?: MessageCacheMetricSink;
    onStatusChange?: (status: ActiveRealtimeHistoryStatus) => void;
  }) {
    this.#onStatusChange = onStatusChange;
    this.#store = new IndexedDbMessageStore({
      kind: "realtime-viz",
      sessionId,
      retentionWindowMs,
      maxCacheSize,
      metricSink,
      onReplayableRangeChange: ({ hasRange }) => {
        if (this.#initialized && !this.#disabled && !this.#closing) {
          this.#persistedRangeVersion++;
          this.#setStatus(hasRange ? "ready" : "initializing");
        }
      },
      onWriteFailure: (error) => {
        this.#disable(error, "Disabling realtime viz history cache after persistence failure:");
        this.#discardAfterFailure();
      },
    });
  }

  public async init(): Promise<void> {
    const resetGeneration = this.#resetGeneration;
    try {
      await this.#store.init();
      // A concurrent close owns teardown. Treat it as a normal lifecycle race rather than
      // abandoning the same session twice and reporting a spurious initialization failure.
      if (this.#disabled) {
        return;
      }
      if (!this.#store.isWritable()) {
        throw new Error("Realtime history cache is unavailable for writes");
      }
      if (this.#hasResetStarted(resetGeneration)) {
        return;
      }

      // Reopening a session can reuse a playable range even while its live source is idle.
      // Read before draining the buffer so its append callbacks cannot overtake this snapshot.
      const hasInitialRange = await this.#readPersistedRange();
      if (this.#isDisabled() || this.#hasResetStarted(resetGeneration)) {
        return;
      }

      let hadBufferedEvents = false;
      while (this.#pendingEvents.length > 0) {
        hadBufferedEvents = true;
        const pendingEvents = this.#pendingEvents;
        this.#pendingEvents = [];
        this.#pendingEstimatedBytes = 0;
        await this.#appendToStore(pendingEvents);
        if (this.#isDisabled()) {
          return;
        }
        if (this.#hasResetStarted(resetGeneration)) {
          return;
        }
      }
      this.#initialized = true;
      this.#persistLatestMetadata();
      // Buffered events may replace the old range during pruning. Let their normal flush
      // callback establish readiness from the committed range instead of publishing this snapshot.
      this.#setStatus(!hadBufferedEvents && hasInitialRange ? "ready" : "initializing");
      this.#scheduleRangeRefresh();
    } catch (error) {
      if (this.#closing || this.#hasResetStarted(resetGeneration)) {
        return;
      }
      this.#disable(error, "Failed to initialize realtime viz history cache:");
      await this.#store.discardAndSeal("abandoned");
      throw error;
    }
  }

  async #readPersistedRange(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = async () => {
        const before = await this.#store.getSessionMetadata();
        if (before?.status !== "active" || before.cleanupToken != undefined) {
          return false;
        }
        const stats = await this.#store.stats();
        const after = await this.#store.getSessionMetadata();
        // A reset by another connection must invalidate the snapshot before it is published.
        // Timestamps prove the range even when another writer changed this connection's count.
        return (
          after?.status === "active" &&
          after.cleanupToken == undefined &&
          (before.contentRevision ?? 0) === (after.contentRevision ?? 0) &&
          stats.earliest != undefined &&
          stats.latest != undefined &&
          isGreaterThan(stats.latest, stats.earliest)
        );
      };
      // These reads happen after the store's own initialization deadline has finished.
      return await race([
        read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Timed out reading the realtime cache range"));
          }, RANGE_READ_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer != undefined) {
        clearTimeout(timer);
      }
    }
  }

  #scheduleRangeRefresh(): void {
    if (
      this.#disabled ||
      this.#closing ||
      !this.#initialized ||
      this.#rangeRefreshTimer != undefined ||
      this.#rangeRefreshPromise != undefined
    ) {
      return;
    }
    // Idle connections also need to observe resets by other writers. Poll bounded index keys,
    // without overlapping reads or relying on BroadcastChannel availability in workers.
    this.#rangeRefreshTimer = setTimeout(() => {
      this.#rangeRefreshTimer = undefined;
      const resetGeneration = this.#resetGeneration;
      const persistedRangeVersion = this.#persistedRangeVersion;
      const isCurrent = () =>
        !this.#disabled &&
        !this.#closing &&
        !this.#hasResetStarted(resetGeneration) &&
        persistedRangeVersion === this.#persistedRangeVersion;
      const refresh = this.#readPersistedRange().then(
        (hasRange) => {
          if (isCurrent()) {
            this.#setStatus(hasRange ? "ready" : "initializing");
          }
        },
        (error: unknown) => {
          if (isCurrent()) {
            this.#disable(error, "Failed to refresh realtime cache readiness:");
            this.#discardAfterFailure();
          }
        },
      );
      this.#rangeRefreshPromise = refresh;
      void refresh.finally(() => {
        if (this.#rangeRefreshPromise === refresh) {
          this.#rangeRefreshPromise = undefined;
        }
        this.#scheduleRangeRefresh();
      });
    }, RANGE_REFRESH_INTERVAL_MS);
  }

  #cancelRangeRefresh(): void {
    if (this.#rangeRefreshTimer != undefined) {
      clearTimeout(this.#rangeRefreshTimer);
      this.#rangeRefreshTimer = undefined;
    }
  }

  public append(events: readonly MessageEvent[]): void {
    if (this.#disabled || this.#closing || events.length === 0) {
      return;
    }

    if (!this.#initialized) {
      const addedEstimatedBytes = events.reduce(
        (total, event) => total + event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
        0,
      );
      if (
        !Number.isFinite(addedEstimatedBytes) ||
        this.#pendingEvents.length + events.length > DEFAULT_APPEND_QUEUE_MAX_MESSAGES ||
        this.#pendingEstimatedBytes + addedEstimatedBytes > DEFAULT_APPEND_QUEUE_MAX_BYTES
      ) {
        this.#disable(
          new Error(
            `Realtime history pending queue exceeded its ${DEFAULT_APPEND_QUEUE_MAX_MESSAGES}-message or ${DEFAULT_APPEND_QUEUE_MAX_BYTES}-byte limit`,
          ),
          "Disabling realtime viz history cache while persistence was pending:",
        );
        this.#discardAfterFailure();
        return;
      }
      this.#pendingEvents.push(...events);
      this.#pendingEstimatedBytes += addedEstimatedBytes;
      return;
    }

    void this.#appendToStore(events).catch((error: unknown) => {
      this.#disable(error, "Disabling realtime viz history cache after append failure:");
      this.#discardAfterFailure();
    });
  }

  // Drop a provisional timeline while buffering events from the replacement timeline. Flushing
  // before clear prevents an already queued append from repopulating the store after deletion.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public reset(): Promise<void> {
    if (this.#disabled || this.#closing) {
      return Promise.resolve();
    }

    this.#resetGeneration++;
    this.#initialized = false;
    this.#cancelRangeRefresh();
    this.#pendingEvents = [];
    this.#pendingEstimatedBytes = 0;
    this.#setStatus("initializing");

    if (this.#resetPromise != undefined) {
      return this.#resetPromise;
    }

    const resetPromise = this.#resetImpl()
      .catch((error: unknown) => {
        const failure = this.#disable(error, "Failed to reset realtime viz history cache:");
        this.#discardAfterFailure();
        throw failure;
      })
      .finally(() => {
        if (this.#resetPromise === resetPromise) {
          this.#resetPromise = undefined;
        }
      });
    this.#resetPromise = resetPromise;
    void resetPromise.catch(() => undefined);
    return resetPromise;
  }

  async #resetImpl(): Promise<void> {
    while (!this.#disabled) {
      const resetGeneration = this.#resetGeneration;
      await Promise.all(Array.from(this.#metadataWrites));
      await this.#store.flush();
      if (this.#isDisabled()) {
        return;
      }
      await this.#store.clear();
      if (this.#isDisabled()) {
        return;
      }
      if (resetGeneration !== this.#resetGeneration) {
        continue;
      }

      while (this.#pendingEvents.length > 0) {
        const pendingEvents = this.#pendingEvents;
        this.#pendingEvents = [];
        this.#pendingEstimatedBytes = 0;
        await this.#appendToStore(pendingEvents);
        if (this.#isDisabled()) {
          return;
        }
        if (resetGeneration !== this.#resetGeneration) {
          break;
        }
      }
      if (resetGeneration !== this.#resetGeneration) {
        continue;
      }

      this.#initialized = true;
      this.#persistLatestMetadata();
      this.#scheduleRangeRefresh();
      return;
    }
  }

  async #appendToStore(events: readonly MessageEvent[]): Promise<void> {
    await this.#store.append(events, {
      // The WebSocket player already normalizes sizeInBytes against its decoded-size estimate.
      // Reuse it instead of recursively walking the same message again on this hot path.
      estimatedSizeBytes: events.map(
        (event) => event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
      ),
    });
  }

  public storeTopics(
    topics: readonly TopicWithDecodingInfo[] | undefined,
    topicStats: Map<string, TopicStats>,
  ): void {
    if (this.#disabled || this.#closing || topics == undefined) {
      return;
    }
    this.#latestTopics = topics;
    this.#latestTopicStats = topicStats;
    if (!this.#initialized) {
      return;
    }
    this.#trackMetadataWrite(
      this.#store.storeTopics(topics, topicStats),
      "Failed to store realtime topic metadata:",
    );
  }

  public storeDatatypes(datatypes: RosDatatypes): void {
    if (this.#disabled || this.#closing) {
      return;
    }
    this.#latestDatatypes = datatypes;
    if (!this.#initialized) {
      return;
    }
    this.#trackMetadataWrite(
      this.#store.storeDatatypes(datatypes),
      "Failed to store realtime datatypes:",
    );
  }

  #persistLatestMetadata(): void {
    if (this.#latestTopics != undefined) {
      this.#trackMetadataWrite(
        this.#store.storeTopics(this.#latestTopics, this.#latestTopicStats),
        "Failed to store realtime topic metadata:",
      );
    }
    if (this.#latestDatatypes != undefined) {
      this.#trackMetadataWrite(
        this.#store.storeDatatypes(this.#latestDatatypes),
        "Failed to store realtime datatypes:",
      );
    }
  }

  #trackMetadataWrite(write: Promise<void>, failureMessage: string): void {
    const trackedWrite = write.catch((error: unknown) => {
      const failure = this.#disable(error, failureMessage);
      this.#discardAfterFailure();
      throw failure;
    });
    this.#metadataWrites.add(trackedWrite);
    const removeTrackedWrite = () => {
      this.#metadataWrites.delete(trackedWrite);
    };
    void trackedWrite.then(removeTrackedWrite, removeTrackedWrite);
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public close(): Promise<void> {
    this.#closePromise ??= this.#closeImpl();
    return this.#closePromise;
  }

  async #closeImpl(): Promise<void> {
    this.#closing = true;
    this.#cancelRangeRefresh();
    const resetPromise = this.#resetPromise;
    if (resetPromise != undefined) {
      try {
        await resetPromise;
      } catch {
        // Reset records the failure and starts abandonment; the disabled path below finishes it.
      }
    }
    if (this.#disabled || !this.#initialized) {
      this.#disabled = true;
      this.#pendingEvents = [];
      this.#pendingEstimatedBytes = 0;
      await this.#store.discardAndSeal("abandoned");
      if (this.#failure != undefined) {
        throw this.#failure;
      }
      return;
    }
    this.#disabled = true;
    try {
      await this.#store.closeAfter(Array.from(this.#metadataWrites));
      if (this.#failure != undefined) {
        throw this.#failure;
      }
    } catch (error) {
      try {
        await this.#store.discardAndSeal("abandoned");
      } catch (closeError) {
        log.debug("Failed to abandon realtime cache after flush failure", closeError);
      }
      throw error;
    }
  }

  #setStatus(status: ActiveRealtimeHistoryStatus): void {
    if (this.#status === status) {
      return;
    }
    this.#status = status;
    this.#onStatusChange?.(status);
  }

  #isDisabled(): boolean {
    // Async initialization can race close() even though synchronous control-flow analysis cannot.
    return this.#disabled;
  }

  #hasResetStarted(generation: number): boolean {
    // Async initialization can also race a first-clock reset between awaited operations.
    return this.#resetPromise != undefined || generation !== this.#resetGeneration;
  }

  #disable(error: unknown, failureMessage: string): Error {
    const failure =
      error instanceof Error ? error : new Error("Realtime visualization history cache failed");
    this.#failure ??= failure;
    this.#disabled = true;
    this.#cancelRangeRefresh();
    this.#pendingEvents = [];
    this.#pendingEstimatedBytes = 0;
    this.#setStatus("unavailable");
    log.warn(failureMessage, error);
    return this.#failure;
  }

  #discardAfterFailure(): void {
    void this.#store.discardAndSeal("abandoned").catch((error: unknown) => {
      log.debug("Failed to abandon realtime cache after a persistence failure", error);
    });
  }
}
