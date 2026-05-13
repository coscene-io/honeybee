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

import { IndexedDbMessageStore } from "./IndexedDbMessageStore";

const log = Log.getLogger(__filename);

export class RealtimeVizHistoryCache {
  #store: IndexedDbMessageStore;
  #disabled = false;
  #latestTopics: readonly TopicWithDecodingInfo[] | undefined;
  #latestTopicStats: Map<string, TopicStats> | undefined;
  #latestDatatypes: RosDatatypes | undefined;

  public constructor({
    sessionId,
    retentionWindowMs,
    maxCacheSize,
  }: {
    sessionId: string;
    retentionWindowMs: number;
    maxCacheSize?: number;
  }) {
    this.#store = new IndexedDbMessageStore({
      kind: "realtime-viz",
      sessionId,
      retentionWindowMs,
      maxCacheSize,
    });
  }

  public async init(): Promise<void> {
    try {
      await this.#store.init();
    } catch (error) {
      this.#disabled = true;
      log.warn("Failed to initialize realtime viz history cache:", error);
      throw error;
    }
  }

  public append(events: readonly MessageEvent[]): void {
    if (this.#disabled) {
      return;
    }
    void this.#store.append(events).catch((error: unknown) => {
      this.#disabled = true;
      log.warn("Disabling realtime viz history cache after append failure:", error);
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

  public async close(): Promise<void> {
    if (this.#disabled) {
      return;
    }
    try {
      await this.flush();
    } finally {
      await this.#store.close();
    }
  }
}
