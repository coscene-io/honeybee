// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

import Log from "@foxglove/log";
import type { MessageEvent } from "@foxglove/studio";
import { TopicWithDecodingInfo } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { estimateObjectSize } from "@foxglove/studio-base/players/messageMemoryEstimation";
import type { TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { IndexedDbMessageStore, type MessageCacheMetricSink } from "./IndexedDbMessageStore";

const log = Log.getLogger(__filename);
const PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES = 256;
const REALTIME_CACHE_FLUSH_TIMEOUT_MS = 5_000;

class RealtimeCacheFlushTimeoutError extends Error {}

async function withFlushDeadline(operation: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new RealtimeCacheFlushTimeoutError("Timed out flushing realtime cache metadata"));
        }, REALTIME_CACHE_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer != undefined) {
      clearTimeout(timer);
    }
  }
}

function estimateMessageCacheBytes(event: MessageEvent): number {
  try {
    return (
      Math.max(event.sizeInBytes, estimateObjectSize(event)) +
      PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES
    );
  } catch (error) {
    log.debug("Falling back to the declared message size for cache accounting", error);
    return event.sizeInBytes + PERSISTED_MESSAGE_INDEX_OVERHEAD_BYTES;
  }
}

export class RealtimeVizHistoryCache {
  #store: IndexedDbMessageStore;
  #disabled = false;
  #latestTopics: readonly TopicWithDecodingInfo[] | undefined;
  #latestTopicStats: Map<string, TopicStats> | undefined;
  #latestDatatypes: RosDatatypes | undefined;
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
      if (!this.#store.isWritable()) {
        throw new Error("Realtime history cache is unavailable for writes");
      }
    } catch (error) {
      this.#disabled = true;
      await this.#store.discardAndSeal("abandoned");
      log.warn("Failed to initialize realtime viz history cache:", error);
      throw error;
    }
  }

  public append(events: readonly MessageEvent[]): void {
    if (this.#disabled) {
      return;
    }
    void this.#store
      .append(events, {
        estimatedSizeBytes: events.map(estimateMessageCacheBytes),
      })
      .catch((error: unknown) => {
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
    void this.#store.storeTopics(topics, topicStats).catch((error: unknown) => {
      log.debug("Failed to store realtime topic metadata:", error);
    });
  }

  public storeDatatypes(datatypes: RosDatatypes): void {
    if (this.#disabled) {
      return;
    }
    this.#latestDatatypes = datatypes;
    void this.#store.storeDatatypes(datatypes).catch((error: unknown) => {
      log.debug("Failed to store realtime datatypes:", error);
    });
  }

  public async flush(): Promise<void> {
    if (this.#disabled) {
      return;
    }
    if (this.#latestTopics != undefined) {
      await this.#store.storeTopics(this.#latestTopics, this.#latestTopicStats);
    }
    if (this.#latestDatatypes != undefined) {
      await this.#store.storeDatatypes(this.#latestDatatypes);
    }
    await this.#store.flush();
  }

  // Returning the stored promise directly preserves identity across concurrent callers.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public close(): Promise<void> {
    this.#closePromise ??= this.#closeImpl();
    return this.#closePromise;
  }

  async #closeImpl(): Promise<void> {
    if (this.#disabled) {
      await this.#store.discardAndSeal("abandoned");
      return;
    }
    try {
      await withFlushDeadline(this.flush());
      await this.#store.close();
    } catch (error) {
      this.#disabled = true;
      try {
        await this.#store.discardAndSeal("abandoned");
      } catch (closeError) {
        log.debug("Failed to abandon realtime cache after flush failure", closeError);
      }
      throw error;
    }
  }
}
