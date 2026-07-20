// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@foxglove/log";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import type { TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { IndexedDbMessageStore, type MessageCacheMetricSink } from "./IndexedDbMessageStore";

const log = Log.getLogger(__filename);
const PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES = 256;

export class RealtimeVizHistoryCache {
  #store: IndexedDbMessageStore;
  #disabled = false;
  #initialized = false;
  #latestTopics: readonly TopicWithDecodingInfo[] | undefined;
  #latestTopicStats: Map<string, TopicStats> | undefined;
  #latestDatatypes: RosDatatypes | undefined;
  #metadataWrites = new Set<Promise<void>>();
  #closePromise: Promise<void> | undefined;

  public constructor({
    sessionId,
    retentionWindowMs,
    maxCacheSize,
    metricSink,
  }: {
    sessionId: string;
    retentionWindowMs: number;
    maxCacheSize?: number;
    metricSink?: MessageCacheMetricSink;
  }) {
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
      this.#initialized = true;
      this.#persistLatestMetadata();
    } catch (error) {
      this.#disabled = true;
      await this.#store.discardAndSeal("abandoned");
      log.warn("Failed to initialize realtime viz history cache:", error);
      throw error;
    }
  }

  public append(events: readonly MessageEvent[]): void {
    // Realtime history is best-effort. Do not retain messages in one Promise per event while the
    // database open is pending; the store's bounded append queue only applies after initialization.
    if (this.#disabled || !this.#initialized) {
      return;
    }
    void this.#store
      .append(events, {
        // The WebSocket player already normalizes sizeInBytes against its decoded-size estimate.
        // Reuse it instead of recursively walking the same message again on this hot path.
        estimatedSizeBytes: events.map(
          (event) => event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES,
        ),
      })
      .catch((error: unknown) => {
        if (this.#disabled) {
          return;
        }
        this.#disabled = true;
        log.warn("Disabling realtime viz history cache after append failure:", error);
        void this.#store.discardAndSeal("abandoned");
      });
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
      log.debug(failureMessage, error);
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
      await this.#store.discardAndSeal("abandoned");
      return;
    }
    this.#disabled = true;
    try {
      await this.#store.closeAfter(Array.from(this.#metadataWrites));
    } catch (error) {
      try {
        await this.#store.discardAndSeal("abandoned");
      } catch (closeError) {
        log.debug("Failed to abandon realtime cache after flush failure", closeError);
      }
      throw error;
    }
  }
}
