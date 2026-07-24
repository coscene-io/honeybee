/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import {
  PlaybackPerformanceMetrics,
  logPlaybackPerformanceMetric,
  sanitizePlaybackPerformanceMetricData,
  sanitizePrivacySafeCaptureResult,
} from "@foxglove/studio-base/services/playbackPerformanceTelemetry";

describe("PlaybackPerformanceMetrics", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("emits one aggregate after the player and all visual work settle", () => {
    let now = 0;
    const sink = jest.fn();
    const metrics = new PlaybackPerformanceMetrics({
      sampleRate: 1,
      settleDelayMs: 100,
      seekTimeoutMs: 1_000,
      now: () => now,
      random: () => 0,
    });
    const uninstall = metrics.installSink(sink);

    metrics.beginSeek();
    const seekId = metrics.captureActiveSeek();
    const finishFirstVisualTask = metrics.beginVisualTask()!;
    const finishSecondVisualTask = metrics.beginVisualTask()!;
    metrics.recordVideoLookback(seekId, 30.4, "success");
    metrics.recordVideoRangeRead(seekId, 12.2, "success");
    metrics.recordVideoRangeReadRetry(seekId);
    metrics.recordGopCacheLookup("hit");
    metrics.recordGopCacheLookup("miss");
    metrics.recordGopCacheSize(1_024);
    metrics.recordGopCacheEviction(256);
    metrics.recordStateTransitionBuild(8.6, 100, 20);
    metrics.recordLongTask(51.2);

    now = 40;
    metrics.markPlayerReady(38.7, { topicCount: 11, messageCount: 3 });
    jest.advanceTimersByTime(100);
    expect(sink).not.toHaveBeenCalled();

    now = 70;
    finishFirstVisualTask();
    finishFirstVisualTask();
    jest.advanceTimersByTime(100);
    expect(sink).not.toHaveBeenCalled();

    now = 90;
    finishSecondVisualTask();
    now = 190;
    jest.advanceTimersByTime(100);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "settled",
        sample_rate: 1,
        duration_ms: 190,
        player_ready_ms: 39,
        topic_count: 11,
        message_count: 3,
        visual_settle_ms: 190,
        visual_task_count: 2,
        visual_task_count_bucket: "2",
        visual_task_ms_max: 90,
        lookback_count: 1,
        lookback_ms_total: 30,
        lookback_success_count: 1,
        range_read_count: 1,
        range_read_retry_count: 1,
        gop_cache_hit_count: 1,
        gop_cache_miss_count: 1,
        gop_cache_peak_bytes: 1_024,
        gop_cache_evicted_bytes: 256,
        state_build_count: 1,
        state_build_ms_total: 9,
        state_input_points_max: 100,
        state_output_points_max: 20,
        long_task_count: 1,
        long_task_ms_total: 51,
      }),
    );

    uninstall();
  });

  it("isolates stale visual completion callbacks from a superseding seek", () => {
    let now = 0;
    const sink = jest.fn();
    const metrics = new PlaybackPerformanceMetrics({
      sampleRate: 1,
      settleDelayMs: 10,
      now: () => now,
      random: () => 0,
    });
    const uninstall = metrics.installSink(sink);

    metrics.beginSeek();
    const staleSeekId = metrics.captureActiveSeek();
    const finishStaleTask = metrics.beginVisualTask()!;
    now = 5;
    metrics.beginSeek();
    metrics.markPlayerReady(2);
    metrics.recordVideoLookback(staleSeekId, 25, "cancelled");
    metrics.recordLongTask(50, 0);
    finishStaleTask();
    now = 15;
    jest.advanceTimersByTime(10);

    expect(sink.mock.calls.map(([metric]) => metric.status)).toEqual(["superseded", "settled"]);
    expect(sink.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        visual_task_count: 0,
        visual_task_count_bucket: "0",
        lookback_count: 0,
        long_task_count: 0,
      }),
    );

    uninstall();
  });

  it("emits a timeout if readiness or visual completion never arrives", () => {
    let now = 0;
    const sink = jest.fn();
    const metrics = new PlaybackPerformanceMetrics({
      sampleRate: 1,
      seekTimeoutMs: 500,
      now: () => now,
      random: () => 0,
    });
    const uninstall = metrics.installSink(sink);

    metrics.beginSeek();
    metrics.beginVisualTask();
    now = 500;
    jest.advanceTimersByTime(500);

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "timeout",
        duration_ms: 500,
      }),
    );

    uninstall();
  });

  it("does no aggregation for an unsampled seek", () => {
    const sink = jest.fn();
    const metrics = new PlaybackPerformanceMetrics({
      sampleRate: 0.1,
      random: () => 0.5,
    });
    const uninstall = metrics.installSink(sink);

    metrics.beginSeek();
    metrics.markPlayerReady(10);
    metrics.recordGopCacheLookup("hit");
    jest.runOnlyPendingTimers();

    expect(sink).not.toHaveBeenCalled();
    uninstall();
  });
});

describe("playback performance telemetry transport", () => {
  it("only retains fixed metric fields and valid enum values", () => {
    expect(
      sanitizePlaybackPerformanceMetricData({
        status: "settled",
        sample_rate: 0.1,
        duration_ms: 123,
        visual_task_count_bucket: "3-4",
        source_url: "https://example.test/file?signature=secret",
        topic: "/private/topic",
        layout: { private: true },
        arbitrary: 42,
      }),
    ).toEqual({
      status: "settled",
      sample_rate: 0.1,
      duration_ms: 123,
      visual_task_count_bucket: "3-4",
    });
  });

  it("removes SDK-added URLs and caller data in the final PostHog hook", () => {
    expect(
      sanitizePrivacySafeCaptureResult({
        uuid: "metric-id",
        event: AppEvent.PLAYBACK_PERFORMANCE,
        properties: {
          token: "posthog-token",
          distinct_id: "user-id",
          release: "v1.2.3",
          status: "settled",
          duration_ms: 123,
          $current_url: "https://example.test/project?signature=secret",
          $referrer: "https://search.test/?q=private",
          topic: "/private/topic",
          arbitrary: "private",
        },
        $set: { $current_url: "https://example.test/person?secret=true" },
      }),
    ).toEqual({
      uuid: "metric-id",
      event: AppEvent.PLAYBACK_PERFORMANCE,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        release: "v1.2.3",
        status: "settled",
        duration_ms: 123,
      },
    });
  });

  it("keeps the stacked seek-event privacy filter active", () => {
    expect(
      sanitizePrivacySafeCaptureResult({
        uuid: "metric-id",
        event: AppEvent.PLAYER_SEEK_LATENCY,
        properties: {
          token: "posthog-token",
          latency_ms: 123,
          topic_count: 5,
          $current_url: "https://example.test/project?signature=secret",
          topic: "/private/topic",
        },
      }),
    ).toEqual({
      uuid: "metric-id",
      event: AppEvent.PLAYER_SEEK_LATENCY,
      properties: {
        token: "posthog-token",
        latency_ms: 123,
        topic_count: 5,
      },
    });
  });

  it("supports synchronous analytics implementations", () => {
    const logEvent = jest.fn(() => undefined);

    expect(() => {
      logPlaybackPerformanceMetric({ logEvent }, { status: "settled", duration_ms: 100 });
    }).not.toThrow();
    expect(logEvent).toHaveBeenCalledWith(AppEvent.PLAYBACK_PERFORMANCE, {
      status: "settled",
      duration_ms: 100,
    });
  });
});
