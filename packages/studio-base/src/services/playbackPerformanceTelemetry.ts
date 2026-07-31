// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BeforeSendFn, CaptureResult, Properties } from "posthog-js";

import type IAnalytics from "@foxglove/studio-base/services/IAnalytics";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import {
  sanitizeAnalyticsCaptureResult,
  sanitizePostHogPrimitiveProperties,
} from "@foxglove/studio-base/services/messageCacheTelemetry";

export const DEFAULT_PLAYBACK_PERFORMANCE_SAMPLE_RATE = 0.1;

const DEFAULT_SETTLE_DELAY_MS = 250;
const DEFAULT_SEEK_TIMEOUT_MS = 15_000;

const SAFE_STATUS_VALUES = new Set(["settled", "timeout", "superseded", "closed"]);
const SAFE_STRING_KEYS = new Set(["status"]);
// Metric semantics notes:
// - `duration_ms` with status "settled" is a task-quiet proxy: time from the accepted seek until
//   player readiness plus a quiet period with no pending keyframe-search visual tasks. It is NOT
//   observed paint or decoded-frame presentation, and long tasks do not extend it.
// - The field set is deliberately restricted to outcome/count metrics our code controls.
//   Externally-dominated measurements (network/data-shaped durations, byte gauges, point maxima)
//   were removed per review: they varied with device, data, and network rather than with our
//   design decisions.
const SAFE_NUMBER_KEYS = new Set([
  "sample_rate",
  "duration_ms",
  "player_ready_ms",
  "topic_count",
  "message_count",
  "lookback_count",
  "lookback_failure_count",
  "lookback_cancel_count",
  "range_read_count",
  "range_read_retry_count",
  "range_read_failure_count",
  "range_read_cancel_count",
  "gop_cache_hit_count",
  "gop_cache_miss_count",
  "long_task_count",
  "long_task_ms_total",
]);

export type PlaybackPerformanceStatus = "settled" | "timeout" | "superseded" | "closed";
export type VideoLookbackOutcome = "success" | "failure" | "cancelled";
export type VideoRangeReadOutcome = "success" | "failure" | "cancelled";
export type PlaybackPerformanceMetricData = Readonly<Record<string, string | number>>;

type MetricSink = (data: PlaybackPerformanceMetricData) => void;

type ActiveSeek = {
  id: number;
  startedAt: number;
  playerReadyAt?: number;
  playerReadyMs?: number;
  topicCount?: number;
  messageCount?: number;
  // Pending visual tasks gate the "settled" status; their counts/durations are not emitted.
  pendingVisualTasks: number;
  lookbackCount: number;
  lookbackFailureCount: number;
  lookbackCancelCount: number;
  rangeReadCount: number;
  rangeReadRetryCount: number;
  rangeReadFailureCount: number;
  rangeReadCancelCount: number;
  gopCacheHitCount: number;
  gopCacheMissCount: number;
  longTaskCount: number;
  longTaskMsTotal: number;
  settleTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
};

type PlaybackPerformanceMetricsOptions = {
  sampleRate?: number;
  settleDelayMs?: number;
  seekTimeoutMs?: number;
  now?: () => number;
  random?: () => number;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function rounded(value: number): number {
  return Math.round(finiteNonNegative(value));
}

/**
 * Aggregates detailed playback work into one bounded, privacy-safe event per sampled seek.
 *
 * Hot-path call sites only update numbers on an active sampled seek. They never allocate event
 * payloads or send analytics independently.
 */
export class PlaybackPerformanceMetrics {
  readonly #sampleRate: number;
  readonly #settleDelayMs: number;
  readonly #seekTimeoutMs: number;
  readonly #now: () => number;
  #random: () => number;

  #sink: MetricSink | undefined;
  #activeSeek: ActiveSeek | undefined;
  #nextSeekId = 0;
  #longTaskObserver: PerformanceObserver | undefined;

  public constructor(options: PlaybackPerformanceMetricsOptions = {}) {
    const requestedSampleRate = options.sampleRate ?? DEFAULT_PLAYBACK_PERFORMANCE_SAMPLE_RATE;
    this.#sampleRate = Math.min(
      1,
      Math.max(
        0,
        Number.isFinite(requestedSampleRate)
          ? requestedSampleRate
          : DEFAULT_PLAYBACK_PERFORMANCE_SAMPLE_RATE,
      ),
    );
    this.#settleDelayMs = finiteNonNegative(options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS);
    this.#seekTimeoutMs = finiteNonNegative(options.seekTimeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS);
    this.#now = options.now ?? (() => performance.now());
    this.#random = options.random ?? Math.random;
  }

  public installSink(sink: MetricSink): () => void {
    this.#sink = sink;

    return () => {
      if (this.#sink !== sink) {
        return;
      }
      this.finishCurrent("closed");
      this.#sink = undefined;
      this.#longTaskObserver?.disconnect();
      this.#longTaskObserver = undefined;
    };
  }

  /**
   * Test helper: force or restore the sampling decision on the process-wide singleton. The
   * constructor captures Math.random by reference, so spying on Math.random in a test has no
   * effect on an already-constructed instance.
   */
  public overrideRandomForTests(random: (() => number) | undefined): void {
    this.#random = random ?? Math.random;
  }

  /**
   * Called when a new player instance is initialized for a (possibly different) data source. The
   * singleton outlives player instances and IterablePlayer never calls the metrics collector's
   * close(), so without this a seek sampled on the old player could absorb the new player's
   * cache/state/readiness activity for up to the deadline timeout and emit cross-player metrics.
   */
  public handlePlayerChange(): void {
    this.finishCurrent("closed");
  }

  public beginSeek(): void {
    // Video work already in flight for the superseded seek may be cancelled after this flush.
    // Those late callbacks carry the old seek id and are rejected, so lookback/range-read counts
    // are lower bounds around a supersede — a deliberate trade-off to keep the flush synchronous.
    this.finishCurrent("superseded");
    if (this.#sink == undefined || this.#random() >= this.#sampleRate) {
      return;
    }

    const activeSeek: ActiveSeek = {
      id: ++this.#nextSeekId,
      startedAt: this.#now(),
      pendingVisualTasks: 0,
      lookbackCount: 0,
      lookbackFailureCount: 0,
      lookbackCancelCount: 0,
      rangeReadCount: 0,
      rangeReadRetryCount: 0,
      rangeReadFailureCount: 0,
      rangeReadCancelCount: 0,
      gopCacheHitCount: 0,
      gopCacheMissCount: 0,
      longTaskCount: 0,
      longTaskMsTotal: 0,
    };
    activeSeek.deadlineTimer = setTimeout(() => {
      if (this.#activeSeek?.id === activeSeek.id) {
        this.finishCurrent("timeout");
      }
    }, this.#seekTimeoutMs);
    this.#activeSeek = activeSeek;
    this.#installLongTaskObserver();
  }

  public markPlayerReady(
    latencyMs: number,
    details?: Readonly<{ topicCount: number; messageCount: number }>,
  ): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined) {
      return;
    }
    activeSeek.playerReadyAt = this.#now();
    activeSeek.playerReadyMs = finiteNonNegative(latencyMs);
    if (details != undefined) {
      activeSeek.topicCount = finiteNonNegative(details.topicCount);
      activeSeek.messageCount = finiteNonNegative(details.messageCount);
    }
    this.#scheduleSettle(activeSeek);
  }

  public beginVisualTask(): (() => void) | undefined {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined) {
      return undefined;
    }

    if (activeSeek.settleTimer != undefined) {
      clearTimeout(activeSeek.settleTimer);
      activeSeek.settleTimer = undefined;
    }
    const seekId = activeSeek.id;
    activeSeek.pendingVisualTasks++;

    let finished = false;
    return () => {
      if (finished) {
        return;
      }
      finished = true;
      const currentSeek = this.#activeSeek;
      if (currentSeek?.id !== seekId) {
        return;
      }

      currentSeek.pendingVisualTasks = Math.max(0, currentSeek.pendingVisualTasks - 1);
      this.#scheduleSettle(currentSeek);
    };
  }

  /** Capture before asynchronous work so a late result cannot leak into a superseding seek. */
  public captureActiveSeek(): number | undefined {
    return this.#activeSeek?.id;
  }

  public recordVideoLookback(seekId: number | undefined, outcome: VideoLookbackOutcome): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined || activeSeek.id !== seekId) {
      return;
    }
    activeSeek.lookbackCount++;
    if (outcome === "cancelled") {
      activeSeek.lookbackCancelCount++;
    } else if (outcome === "failure") {
      activeSeek.lookbackFailureCount++;
    }
  }

  public recordVideoRangeRead(seekId: number | undefined, outcome: VideoRangeReadOutcome): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined || activeSeek.id !== seekId) {
      return;
    }
    activeSeek.rangeReadCount++;
    if (outcome === "failure") {
      activeSeek.rangeReadFailureCount++;
    } else if (outcome === "cancelled") {
      activeSeek.rangeReadCancelCount++;
    }
  }

  public recordVideoRangeReadRetry(seekId: number | undefined): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek != undefined && activeSeek.id === seekId) {
      activeSeek.rangeReadRetryCount++;
    }
  }

  public recordGopCacheLookup(outcome: "hit" | "miss"): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined) {
      return;
    }
    if (outcome === "hit") {
      activeSeek.gopCacheHitCount++;
    } else {
      activeSeek.gopCacheMissCount++;
    }
  }

  public recordLongTask(durationMs: number, startTime?: number): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek != undefined && (startTime == undefined || startTime >= activeSeek.startedAt)) {
      activeSeek.longTaskCount++;
      activeSeek.longTaskMsTotal += finiteNonNegative(durationMs);
    }
  }

  public finishCurrent(status: PlaybackPerformanceStatus): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined) {
      return;
    }
    this.#activeSeek = undefined;
    // Drain entries the observer has queued but not yet delivered; disconnect() would silently
    // drop them and undercount completed long tasks (review finding).
    for (const entry of this.#longTaskObserver?.takeRecords() ?? []) {
      if (entry.startTime >= activeSeek.startedAt) {
        activeSeek.longTaskCount++;
        activeSeek.longTaskMsTotal += finiteNonNegative(entry.duration);
      }
    }
    this.#longTaskObserver?.disconnect();
    this.#longTaskObserver = undefined;
    if (activeSeek.settleTimer != undefined) {
      clearTimeout(activeSeek.settleTimer);
    }
    if (activeSeek.deadlineTimer != undefined) {
      clearTimeout(activeSeek.deadlineTimer);
    }

    const finishedAt = this.#now();
    const durationMs = finiteNonNegative(finishedAt - activeSeek.startedAt);
    const metric: Record<string, string | number> = {
      status,
      sample_rate: this.#sampleRate,
      duration_ms: rounded(durationMs),
      lookback_count: activeSeek.lookbackCount,
      lookback_failure_count: activeSeek.lookbackFailureCount,
      lookback_cancel_count: activeSeek.lookbackCancelCount,
      range_read_count: activeSeek.rangeReadCount,
      range_read_retry_count: activeSeek.rangeReadRetryCount,
      range_read_failure_count: activeSeek.rangeReadFailureCount,
      range_read_cancel_count: activeSeek.rangeReadCancelCount,
      gop_cache_hit_count: activeSeek.gopCacheHitCount,
      gop_cache_miss_count: activeSeek.gopCacheMissCount,
      long_task_count: activeSeek.longTaskCount,
      long_task_ms_total: rounded(activeSeek.longTaskMsTotal),
    };
    if (activeSeek.playerReadyMs != undefined) {
      metric.player_ready_ms = rounded(activeSeek.playerReadyMs);
    }
    if (activeSeek.topicCount != undefined) {
      metric.topic_count = rounded(activeSeek.topicCount);
    }
    if (activeSeek.messageCount != undefined) {
      metric.message_count = rounded(activeSeek.messageCount);
    }
    // No separate settle field: `duration_ms` with status "settled" IS the task-quiet settle
    // proxy (see the schema note above SAFE_NUMBER_KEYS). A duplicate field previously named
    // "visual_settle_ms" was removed because it was byte-identical to duration_ms and its name
    // implied paint observation that does not happen.

    try {
      this.#sink?.(metric);
    } catch {
      // Telemetry must never affect playback.
    }
  }

  #scheduleSettle(activeSeek: ActiveSeek): void {
    if (
      activeSeek.playerReadyAt == undefined ||
      activeSeek.pendingVisualTasks !== 0 ||
      this.#activeSeek?.id !== activeSeek.id
    ) {
      return;
    }
    if (activeSeek.settleTimer != undefined) {
      clearTimeout(activeSeek.settleTimer);
    }
    activeSeek.settleTimer = setTimeout(() => {
      if (
        this.#activeSeek?.id === activeSeek.id &&
        activeSeek.pendingVisualTasks === 0 &&
        activeSeek.playerReadyAt != undefined
      ) {
        this.finishCurrent("settled");
      }
    }, this.#settleDelayMs);
  }

  #installLongTaskObserver(): void {
    if (this.#longTaskObserver != undefined || typeof PerformanceObserver === "undefined") {
      return;
    }
    try {
      this.#longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordLongTask(entry.duration, entry.startTime);
        }
      });
      this.#longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch {
      this.#longTaskObserver = undefined;
    }
  }
}

export const playbackPerformanceMetrics = new PlaybackPerformanceMetrics();

/** Restrict the event to a fixed, numeric schema so call sites cannot add identifying context. */
export function sanitizePlaybackPerformanceMetricData(
  data: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number> {
  const sanitized: Record<string, string | number> = {};
  if (data == undefined) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(data)) {
    if (SAFE_NUMBER_KEYS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (
      SAFE_STRING_KEYS.has(key) &&
      typeof value === "string" &&
      key === "status" &&
      SAFE_STATUS_VALUES.has(value)
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizePlaybackPerformanceCaptureProperties(properties: Properties): Properties {
  return Object.assign(
    sanitizePostHogPrimitiveProperties(properties),
    sanitizePlaybackPerformanceMetricData(properties),
  );
}

/** Fire-and-forget transport supporting both synchronous and asynchronous analytics clients. */
export function logPlaybackPerformanceMetric(
  analytics: Pick<IAnalytics, "logEvent">,
  data: PlaybackPerformanceMetricData,
): void {
  void Promise.resolve(analytics.logEvent(AppEvent.PLAYBACK_PERFORMANCE, data)).catch(
    () => undefined,
  );
}

/** Final PostHog hook: SDK URL/referrer enrichment happens after capture() is called. */
export const sanitizePlaybackPerformanceCaptureResult: BeforeSendFn = (result) => {
  if (result?.event !== AppEvent.PLAYBACK_PERFORMANCE) {
    return result;
  }

  const sanitized: CaptureResult = {
    uuid: result.uuid,
    event: result.event,
    properties: sanitizePlaybackPerformanceCaptureProperties(result.properties),
  };
  if (result.timestamp != undefined) {
    sanitized.timestamp = result.timestamp;
  }
  return sanitized;
};

/** Apply all privacy-safe event filters from one PostHog before_send hook. */
export const sanitizePrivacySafeCaptureResult: BeforeSendFn = (result) => {
  return sanitizePlaybackPerformanceCaptureResult(sanitizeAnalyticsCaptureResult(result));
};
