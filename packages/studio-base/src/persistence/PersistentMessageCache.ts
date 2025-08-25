// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageEvent, Time } from "@foxglove/studio";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

/** @deprecated Use separate PersistentMessageCache instances for session isolation */
export type PersistenceSessionId = string;

/**
 * A persistent cache for message events, backed by a pluggable storage engine.
 * Each cache instance manages a single session internally.
 *
 * Design goals:
 * - Append-only writes with optional retention window pruning
 * - Time-range and topic-range queries
 * - Backfill helper to fetch last message per topic at/just before a time
 * - Session isolation through separate cache instances
 */
export interface PersistentMessageCache {
  /** Initialize underlying storage (idempotent). */
  init(): Promise<void>;

  /**
   * Configure a rolling retention window in milliseconds.
   */
  setRetentionWindowMs(durationMs: number): void;

  /**
   * Append a batch of messages to the cache.
   * Messages may contain multiple topics and are resilient to out-of-order inserts.
   * Optionally performs retention pruning based on the latest message time in the batch.
   */
  append(events: readonly MessageEvent[]): Promise<void>;

  /**
   * Query messages by time range and optional topic filter.
   * Returned messages are sorted by receiveTime (end time is inclusive).
   */
  getMessages(params: {
    start: Time;
    end: Time;
    topics?: readonly string[];
    limit?: number;
  }): Promise<readonly MessageEvent[]>;

  /**
   * For each requested topic, return the last message at or before the provided time.
   * Topics with no available message return no entry.
   */
  getBackfillMessages(params: {
    time: Time;
    topics: readonly string[];
  }): Promise<readonly MessageEvent[]>;

  /** Remove all data from this cache. */
  clear(): Promise<void>;

  /** Close resources (optional for some backends). */
  close(): Promise<void>;

  /** Lightweight stats for observability. */
  stats(): Promise<{
    count: number;
    earliest?: Time;
    latest?: Time;
    approximateSizeBytes?: number;
  }>;

  /** Store datatypes information for this session (optional, may not be supported by all implementations). */
  storeDatatypes?(datatypes: RosDatatypes): Promise<void>;

  /** Retrieve datatypes information for this session (optional, may not be supported by all implementations). */
  getDatatypes?(): Promise<RosDatatypes | undefined>;
}
