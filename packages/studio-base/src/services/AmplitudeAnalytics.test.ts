/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { AmplitudeAnalytics } from "@foxglove/studio-base/services/AmplitudeAnalytics";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import {
  logMessageCacheMetric,
  sanitizeAnalyticsCaptureResult,
  sanitizeMessageCacheCaptureResult,
  sanitizeMessageCacheMetricData,
  sanitizePlayerPerformanceMetricData,
} from "@foxglove/studio-base/services/messageCacheTelemetry";

const mockCapture = jest.fn();

jest.mock("posthog-js", () => ({
  posthog: {
    capture: (...args: unknown[]) => mockCapture(...args),
    register: jest.fn(),
  },
}));

describe("AmplitudeAnalytics", () => {
  beforeEach(() => {
    mockCapture.mockClear();
  });

  it("sends privacy-safe seek events to the analytics backend", async () => {
    const analytics = Object.create(AmplitudeAnalytics.prototype) as AmplitudeAnalytics;

    await analytics.logEvent(AppEvent.PLAYER_SEEK);
    await analytics.logEvent(AppEvent.PLAYER_SEEK_LATENCY, {
      latency_ms: 250,
      topic_count: 11,
      message_count: 3,
      target_url: "https://example.test/private?signature=secret",
    });

    expect(mockCapture).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, undefined);
    expect(mockCapture).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK_LATENCY, {
      latency_ms: 250,
      topic_count: 11,
      message_count: 3,
    });
  });

  it("removes SDK page data and unexpected fields from seek telemetry", () => {
    const result = sanitizeAnalyticsCaptureResult({
      uuid: "metric-id",
      event: AppEvent.PLAYER_SEEK_LATENCY,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        source_id: "coscene-share-manifest",
        latency_ms: 250,
        topic_count: 11,
        message_count: 3,
        $current_url: "https://example.test/project?signature=secret",
        $referrer: "https://search.test/?q=private",
        topic: "/private/topic",
        target_time: "2026-05-18T08:31:26Z",
      },
      $set: { $current_url: "https://example.test/person?secret=true" },
    });

    expect(result).toEqual({
      uuid: "metric-id",
      event: AppEvent.PLAYER_SEEK_LATENCY,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        source_id: "coscene-share-manifest",
        latency_ms: 250,
        topic_count: 11,
        message_count: 3,
      },
    });
  });

  it("only retains finite seek aggregate fields", () => {
    expect(
      sanitizePlayerPerformanceMetricData({
        latency_ms: 250,
        topic_count: 11,
        message_count: Number.POSITIVE_INFINITY,
        target_url: "https://example.test/private?signature=secret",
        topic: "/private/topic",
      }),
    ).toEqual({
      latency_ms: 250,
      topic_count: 11,
    });
  });

  it("sends privacy-safe message cache metrics to the analytics backend", async () => {
    const analytics = Object.create(AmplitudeAnalytics.prototype) as AmplitudeAnalytics;
    const data = {
      metric: "storage",
      kind: "playback-spill",
      usage: 100,
      quota: 1000,
      sourceKey: "https://example.test/file?signature=secret",
      topic: "/private/topic",
    };

    await analytics.logEvent(AppEvent.MESSAGE_CACHE, data);

    expect(mockCapture).toHaveBeenCalledWith(AppEvent.MESSAGE_CACHE, {
      metric: "storage",
      kind: "playback-spill",
      usage: 100,
      quota: 1000,
    });
  });

  it("sends only fixed playback performance fields to the analytics backend", async () => {
    const analytics = Object.create(AmplitudeAnalytics.prototype) as AmplitudeAnalytics;

    await analytics.logEvent(AppEvent.PLAYBACK_PERFORMANCE, {
      status: "settled",
      duration_ms: 150,
      visual_task_count: 2,
      topic: "/private/topic",
      source_url: "https://example.test/file?signature=secret",
    });

    expect(mockCapture).toHaveBeenCalledWith(AppEvent.PLAYBACK_PERFORMANCE, {
      status: "settled",
      duration_ms: 150,
      visual_task_count: 2,
    });
  });

  it("removes URL, referrer, campaign, topic, and message fields after SDK enrichment", () => {
    const result = sanitizeMessageCacheCaptureResult({
      uuid: "metric-id",
      event: AppEvent.MESSAGE_CACHE,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        metric: "open",
        status: "timeout",
        $current_url: "https://example.test/project?signature=secret",
        $initial_current_url: "https://example.test/first?token=secret",
        $referrer: "https://search.test/?q=private",
        $host: "example.test",
        utm_campaign: "private-campaign",
        sourceKey: "https://storage.test/file?signature=secret",
        topic: "/private/topic",
        message: { secret: true },
      },
      $set: { $current_url: "https://example.test/person?secret=true" },
      $set_once: { $initial_person_info: { u: "https://example.test/initial?secret=true" } },
    });

    expect(result).toEqual({
      uuid: "metric-id",
      event: AppEvent.MESSAGE_CACHE,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        metric: "open",
        status: "timeout",
      },
    });
  });

  it("only retains allowed primitive metric shapes", () => {
    expect(
      sanitizeMessageCacheMetricData({
        metric: "open",
        kind: "playback-spill",
        status: "https://example.test/private?signature=secret",
        stage: "/private/topic",
        operation: "background maintenance",
        usage: 100,
        quota: Number.POSITIVE_INFINITY,
        writesDisabled: false,
        interrupted: { value: true },
      }),
    ).toEqual({
      metric: "open",
      kind: "playback-spill",
      operation: "background maintenance",
      usage: 100,
      writesDisabled: false,
    });
  });

  it("accepts synchronous analytics implementations", () => {
    const logEvent = jest.fn(() => undefined);

    expect(() => {
      logMessageCacheMetric({ logEvent }, "cleanup", { status: "succeeded" });
    }).not.toThrow();
    expect(logEvent).toHaveBeenCalledWith(AppEvent.MESSAGE_CACHE, {
      metric: "cleanup",
      status: "succeeded",
    });
  });

  it("rebuilds the final event from explicitly allowed primitive properties", () => {
    const result = sanitizeMessageCacheCaptureResult({
      uuid: "metric-id",
      event: AppEvent.MESSAGE_CACHE,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        $browser: "Chrome",
        platform: "honeybee",
        metric: "cleanup",
        status: "succeeded",
        usage: 100,
        quota: { value: 1_000 },
        operation: "https://example.test/private?signature=secret",
        $groups: { organization: "private-org" },
        arbitrary: "private-message",
      },
    });

    expect(result).toEqual({
      uuid: "metric-id",
      event: AppEvent.MESSAGE_CACHE,
      properties: {
        token: "posthog-token",
        distinct_id: "user-id",
        $browser: "Chrome",
        platform: "honeybee",
        metric: "cleanup",
        status: "succeeded",
        usage: 100,
      },
    });
  });
});
