// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BeforeSendFn, CaptureResult, Properties } from "posthog-js";

import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import {
  sanitizeAnalyticsCaptureResult,
  sanitizePostHogPrimitiveProperties,
} from "@foxglove/studio-base/services/messageCacheTelemetry";

export const DEFAULT_PLAYBACK_PERFORMANCE_SAMPLE_RATE = 0.1;

const DEFAULT_SETTLE_DELAY_MS = 250;
const DEFAULT_SEEK_TIMEOUT_MS = 15_000;

const SAFE_STATUS_VALUES = new Set(["settled", "timeout", "superseded", "closed"]);
const SAFE_VISUAL_TASK_COUNT_BUCKETS = new Set(["0", "1", "2", "3-4", "5-8", "9+"]);
const SAFE_STRING_KEYS = new Set(["status", "visual_task_count_bucket"]);
const SAFE_NUMBER_KEYS = new Set([
  "sample_rate",
  "duration_ms",
  "player_ready_ms",
  "topic_count",
  "message_count",
  "visual_settle_ms",
  "visual_task_count",
  "visual_task_ms_max",
  "lookback_count",
  "lookback_ms_total",
  "lookback_ms_max",
  "lookback_success_count",
  "lookback_failure_count",
  "lookback_cancel_count",
  "range_read_count",
  "range_read_ms_total",
  "range_read_ms_max",
  "range_read_retry_count",
  "range_read_failure_count",
  "gop_cache_hit_count",
  "gop_cache_miss_count",
  "gop_cache_peak_bytes",
  "gop_cache_evicted_bytes",
  "state_build_count",
  "state_build_ms_total",
  "state_build_ms_max",
  "state_input_points_max",
  "state_output_points_max",
  "long_task_count",
  "long_task_ms_total",
]);

export type PlaybackPerformanceStatus = "settled" | "timeout" | "superseded" | "closed";
export type VideoLookbackOutcome = "success" | "failure" | "cancelled";
export type PlaybackPerformanceMetricData = Readonly<Record<string, string | number>>;

type MetricSink = (data: PlaybackPerformanceMetricData) => void;

type ActiveSeek = {
  id: number;
  startedAt: number;
  playerReadyAt?: number;
  playerReadyMs?: number;
  topicCount?: number;
  messageCount?: number;
  pendingVisualTasks: number;
  visualTaskCount: number;
  visualTaskMsMax: number;
  lookbackCount: number;
  lookbackMsTotal: number;
  lookbackMsMax: number;
  lookbackSuccessCount: number;
  lookbackFailureCount: number;
  lookbackCancelCount: number;
  rangeReadCount: number;
  rangeReadMsTotal: number;
  rangeReadMsMax: number;
  rangeReadRetryCount: number;
  rangeReadFailureCount: number;
  gopCacheHitCount: number;
  gopCacheMissCount: number;
  gopCachePeakBytes: number;
  gopCacheEvictedBytes: number;
  stateBuildCount: number;
  stateBuildMsTotal: number;
  stateBuildMsMax: number;
  stateInputPointsMax: number;
  stateOutputPointsMax: number;
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

function visualTaskCountBucket(count: number): string {
  if (count <= 0) {
    return "0";
  }
  if (count === 1) {
    return "1";
  }
  if (count === 2) {
    return "2";
  }
  if (count <= 4) {
    return "3-4";
  }
  if (count <= 8) {
    return "5-8";
  }
  return "9+";
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
  readonly #random: () => number;

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

  public beginSeek(): void {
    this.finishCurrent("superseded");
    if (this.#sink == undefined || this.#random() >= this.#sampleRate) {
      return;
    }

    const activeSeek: ActiveSeek = {
      id: ++this.#nextSeekId,
      startedAt: this.#now(),
      pendingVisualTasks: 0,
      visualTaskCount: 0,
      visualTaskMsMax: 0,
      lookbackCount: 0,
      lookbackMsTotal: 0,
      lookbackMsMax: 0,
      lookbackSuccessCount: 0,
      lookbackFailureCount: 0,
      lookbackCancelCount: 0,
      rangeReadCount: 0,
      rangeReadMsTotal: 0,
      rangeReadMsMax: 0,
      rangeReadRetryCount: 0,
      rangeReadFailureCount: 0,
      gopCacheHitCount: 0,
      gopCacheMissCount: 0,
      gopCachePeakBytes: 0,
      gopCacheEvictedBytes: 0,
      stateBuildCount: 0,
      stateBuildMsTotal: 0,
      stateBuildMsMax: 0,
      stateInputPointsMax: 0,
      stateOutputPointsMax: 0,
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
    const startedAt = this.#now();
    const seekId = activeSeek.id;
    activeSeek.pendingVisualTasks++;
    activeSeek.visualTaskCount++;

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
      currentSeek.visualTaskMsMax = Math.max(
        currentSeek.visualTaskMsMax,
        finiteNonNegative(this.#now() - startedAt),
      );
      this.#scheduleSettle(currentSeek);
    };
  }

  /** Capture before asynchronous work so a late result cannot leak into a superseding seek. */
  public captureActiveSeek(): number | undefined {
    return this.#activeSeek?.id;
  }

  public recordVideoLookback(
    seekId: number | undefined,
    durationMs: number,
    outcome: VideoLookbackOutcome,
  ): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined || activeSeek.id !== seekId) {
      return;
    }
    const duration = finiteNonNegative(durationMs);
    activeSeek.lookbackCount++;
    activeSeek.lookbackMsTotal += duration;
    activeSeek.lookbackMsMax = Math.max(activeSeek.lookbackMsMax, duration);
    if (outcome === "success") {
      activeSeek.lookbackSuccessCount++;
    } else if (outcome === "cancelled") {
      activeSeek.lookbackCancelCount++;
    } else {
      activeSeek.lookbackFailureCount++;
    }
  }

  public recordVideoRangeRead(
    seekId: number | undefined,
    durationMs: number,
    outcome: "success" | "failure",
  ): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined || activeSeek.id !== seekId) {
      return;
    }
    const duration = finiteNonNegative(durationMs);
    activeSeek.rangeReadCount++;
    activeSeek.rangeReadMsTotal += duration;
    activeSeek.rangeReadMsMax = Math.max(activeSeek.rangeReadMsMax, duration);
    if (outcome === "failure") {
      activeSeek.rangeReadFailureCount++;
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

  public recordGopCacheSize(bytes: number): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek != undefined) {
      activeSeek.gopCachePeakBytes = Math.max(
        activeSeek.gopCachePeakBytes,
        finiteNonNegative(bytes),
      );
    }
  }

  public recordGopCacheEviction(bytes: number): void {
    if (this.#activeSeek != undefined) {
      this.#activeSeek.gopCacheEvictedBytes += finiteNonNegative(bytes);
    }
  }

  public recordStateTransitionBuild(
    durationMs: number,
    inputPointCount: number,
    outputPointCount: number,
  ): void {
    const activeSeek = this.#activeSeek;
    if (activeSeek == undefined) {
      return;
    }
    const duration = finiteNonNegative(durationMs);
    activeSeek.stateBuildCount++;
    activeSeek.stateBuildMsTotal += duration;
    activeSeek.stateBuildMsMax = Math.max(activeSeek.stateBuildMsMax, duration);
    activeSeek.stateInputPointsMax = Math.max(
      activeSeek.stateInputPointsMax,
      finiteNonNegative(inputPointCount),
    );
    activeSeek.stateOutputPointsMax = Math.max(
      activeSeek.stateOutputPointsMax,
      finiteNonNegative(outputPointCount),
    );
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
      visual_task_count: activeSeek.visualTaskCount,
      visual_task_ms_max: rounded(activeSeek.visualTaskMsMax),
      visual_task_count_bucket: visualTaskCountBucket(activeSeek.visualTaskCount),
      lookback_count: activeSeek.lookbackCount,
      lookback_ms_total: rounded(activeSeek.lookbackMsTotal),
      lookback_ms_max: rounded(activeSeek.lookbackMsMax),
      lookback_success_count: activeSeek.lookbackSuccessCount,
      lookback_failure_count: activeSeek.lookbackFailureCount,
      lookback_cancel_count: activeSeek.lookbackCancelCount,
      range_read_count: activeSeek.rangeReadCount,
      range_read_ms_total: rounded(activeSeek.rangeReadMsTotal),
      range_read_ms_max: rounded(activeSeek.rangeReadMsMax),
      range_read_retry_count: activeSeek.rangeReadRetryCount,
      range_read_failure_count: activeSeek.rangeReadFailureCount,
      gop_cache_hit_count: activeSeek.gopCacheHitCount,
      gop_cache_miss_count: activeSeek.gopCacheMissCount,
      gop_cache_peak_bytes: rounded(activeSeek.gopCachePeakBytes),
      gop_cache_evicted_bytes: rounded(activeSeek.gopCacheEvictedBytes),
      state_build_count: activeSeek.stateBuildCount,
      state_build_ms_total: rounded(activeSeek.stateBuildMsTotal),
      state_build_ms_max: rounded(activeSeek.stateBuildMsMax),
      state_input_points_max: rounded(activeSeek.stateInputPointsMax),
      state_output_points_max: rounded(activeSeek.stateOutputPointsMax),
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
    if (status === "settled") {
      metric.visual_settle_ms = rounded(durationMs);
    }

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
    } else if (SAFE_STRING_KEYS.has(key) && typeof value === "string") {
      if (
        (key === "status" && SAFE_STATUS_VALUES.has(value)) ||
        (key === "visual_task_count_bucket" && SAFE_VISUAL_TASK_COUNT_BUCKETS.has(value))
      ) {
        sanitized[key] = value;
      }
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
