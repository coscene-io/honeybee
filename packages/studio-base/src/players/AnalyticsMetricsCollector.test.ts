/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import AnalyticsMetricsCollector from "@foxglove/studio-base/players/AnalyticsMetricsCollector";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

describe("AnalyticsMetricsCollector", () => {
  it("records seek attempts and privacy-safe aggregate performance fields", () => {
    const logEvent = jest.fn();
    const analytics: IAnalytics = {
      initPlayer: jest.fn(),
      logEvent,
      setSpeed: jest.fn(),
    };
    const collector = new AnalyticsMetricsCollector({ analytics });

    collector.seek({ sec: 42, nsec: 123 });
    collector.recordSeekLatency(250, { topicCount: 11, messageCount: 3 });
    collector.close();

    expect(logEvent).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, { seek_id: 1 });
    expect(logEvent).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK_LATENCY, {
      seek_id: 1,
      latency_ms: 250,
      message_count: 3,
      topic_count: 11,
    });
  });

  it("joins a completion to the seek attempt that produced it", () => {
    const logEvent = jest.fn();
    const analytics: IAnalytics = {
      initPlayer: jest.fn(),
      logEvent,
      setSpeed: jest.fn(),
    };
    const collector = new AnalyticsMetricsCollector({ analytics });

    // Two accepted seeks; the first is superseded and never completes. Only the second seek's
    // completion event fires, carrying the second seek's id.
    collector.seek({ sec: 1, nsec: 0 });
    collector.seek({ sec: 2, nsec: 0 });
    collector.recordSeekLatency(100, { topicCount: 5, messageCount: 2 });
    collector.close();

    expect(logEvent).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, { seek_id: 1 });
    expect(logEvent).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK, { seek_id: 2 });
    expect(logEvent).toHaveBeenNthCalledWith(3, AppEvent.PLAYER_SEEK_LATENCY, {
      seek_id: 2,
      latency_ms: 100,
      message_count: 2,
      topic_count: 5,
    });
  });
});
