// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@foxglove/log";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import type { RealtimeHistoryStatus, TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { IndexedDbMessageStore, type MessageCacheMetricSink } from "./IndexedDbMessageStore";

const log = Log.getLogger(__filename);
const PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES = 256;
const PENDING_INIT_MAX_BYTES = 128 * 1024 * 1024;

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
  #pendingInitEvents: MessageEvent[] = [];
  #pendingInitEstimatedBytes = 0;
  #status: ActiveRealtimeHistoryStatus = "initializing";
  #onStatusChange?: (status: ActiveRealtimeHistoryStatus) => void;
  #failure?: Error;

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
    });
  }

  public async init(): Promise<void> {
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

      let initializedWithData = false;
      while (this.#pendingInitEvents.length > 0) {
        const pendingEvents = this.#pendingInitEvents;
        this.#pendingInitEvents = [];
        this.#pendingInitEstimatedBytes = 0;
        await this.#appendToStore(pendingEvents, { markReady: false });
        if (this.#isDisabled()) {
          return;
        }
        initializedWithData = true;
      }
      this.#initialized = true;
      this.#persistLatestMetadata();
      if (initializedWithData) {
        this.#setStatus("ready");
      }
    } catch (error) {
      this.#disable(error, "Failed to initialize realtime viz history cache:");
      await this.#store.discardAndSeal("abandoned");
      throw error;
    }
  }

  public append(events: readonly MessageEvent[]): void {
    if (this.#disabled || events.length === 0) {
      return;
    }

    if (!this.#initialized) {
      const addedEstimatedBytes = events.reduce(
        (total, event) => total + event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
        0,
      );
      if (
        !Number.isFinite(addedEstimatedBytes) ||
        this.#pendingInitEstimatedBytes + addedEstimatedBytes > PENDING_INIT_MAX_BYTES
      ) {
        this.#disable(
          new Error(
            `Realtime history initialization queue exceeded its ${PENDING_INIT_MAX_BYTES}-byte limit`,
          ),
          "Disabling realtime viz history cache before initialization completed:",
        );
        this.#discardAfterFailure();
        return;
      }
      this.#pendingInitEvents.push(...events);
      this.#pendingInitEstimatedBytes += addedEstimatedBytes;
      return;
    }

    void this.#appendToStore(events).catch((error: unknown) => {
      this.#disable(error, "Disabling realtime viz history cache after append failure:");
      this.#discardAfterFailure();
    });
  }

  async #appendToStore(
    events: readonly MessageEvent[],
    { markReady = true }: { markReady?: boolean } = {},
  ): Promise<void> {
    await this.#store.append(events, {
      // The WebSocket player already normalizes sizeInBytes against its decoded-size estimate.
      // Reuse it instead of recursively walking the same message again on this hot path.
      estimatedSizeBytes: events.map(
        (event) => event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
      ),
    });
    if (markReady) {
      this.#setStatus("ready");
    }
  }

  public storeTopics(
    topics: readonly TopicWithDecodingInfo[] | undefined,
    topicStats: Map<string, TopicStats>,
  ): void {
    if (this.#disabled || topics == undefined) {
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
    if (this.#disabled) {
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
      this.#disable(error, failureMessage);
      this.#discardAfterFailure();
    });
    this.#metadataWrites.add(trackedWrite);
    void trackedWrite.finally(() => {
      this.#metadataWrites.delete(trackedWrite);
    });
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public close(): Promise<void> {
    this.#closePromise ??= this.#closeImpl();
    return this.#closePromise;
  }

  async #closeImpl(): Promise<void> {
    if (this.#disabled || !this.#initialized) {
      this.#disabled = true;
      this.#pendingInitEvents = [];
      this.#pendingInitEstimatedBytes = 0;
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

  #disable(error: unknown, failureMessage: string): void {
    if (this.#disabled) {
      return;
    }
    this.#disabled = true;
    this.#failure =
      error instanceof Error ? error : new Error("Realtime visualization history cache failed");
    this.#pendingInitEvents = [];
    this.#pendingInitEstimatedBytes = 0;
    this.#setStatus("unavailable");
    log.warn(failureMessage, error);
  }

  #discardAfterFailure(): void {
    void this.#store.discardAndSeal("abandoned").catch((error: unknown) => {
      log.debug("Failed to abandon realtime cache after a persistence failure", error);
    });
  }
}
