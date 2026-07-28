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

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    collector.seek({ sec: 42, nsec: 123 });
    collector.recordSeekLatency(250, { topicCount: 11, messageCount: 3 });
    collector.close();
    nowSpy.mockRestore();

    const expectedId = 1_700_000_000_000 * 1000;
    expect(logEvent).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, { seek_id: expectedId });
    expect(logEvent).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK_LATENCY, {
      seek_id: expectedId,
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
    // completion event fires, carrying the second seek's id. Ids come from wall-clock ms plus a
    // sub-millisecond sequence so same-millisecond seeks remain distinct and joinable.
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    collector.seek({ sec: 1, nsec: 0 });
    collector.seek({ sec: 2, nsec: 0 });
    collector.recordSeekLatency(100, { topicCount: 5, messageCount: 2 });
    collector.close();
    nowSpy.mockRestore();

    const base = 1_700_000_000_000 * 1000;
    expect(logEvent).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, { seek_id: base });
    expect(logEvent).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK, { seek_id: base + 1 });
    expect(logEvent).toHaveBeenNthCalledWith(3, AppEvent.PLAYER_SEEK_LATENCY, {
      seek_id: base + 1,
      latency_ms: 100,
      message_count: 2,
      topic_count: 5,
    });
  });

  it("resets the join id when a new player initializes", () => {
    const logEvent = jest.fn();
    const analytics: IAnalytics = {
      initPlayer: jest.fn(),
      logEvent,
      setSpeed: jest.fn(),
    };
    const collector = new AnalyticsMetricsCollector({ analytics });

    // A seek on the first data source sets a nonzero join id...
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    collector.seek({ sec: 1, nsec: 0 });

    // ...then the user switches sources. A deep-link seek during the new player's
    // initialization emits a completion without a new seek() call; it must carry the
    // documented 0, not the previous player's id.
    collector.setProperty("player", "new-source");
    collector.recordSeekLatency(80, { topicCount: 3, messageCount: 1 });
    collector.close();
    nowSpy.mockRestore();

    expect(logEvent).toHaveBeenLastCalledWith(AppEvent.PLAYER_SEEK_LATENCY, {
      seek_id: 0,
      latency_ms: 80,
      message_count: 1,
      topic_count: 3,
    });
  });

  it("keeps seek ids unique across collector lifetimes within one session", () => {
    const logEvent = jest.fn();
    const analytics: IAnalytics = {
      initPlayer: jest.fn(),
      logEvent,
      setSpeed: jest.fn(),
    };
    // Simulate a page reload: a fresh collector at a later wall-clock time must not reuse the
    // ids the pre-reload collector emitted (a restarted plain counter collided at 1).
    const first = new AnalyticsMetricsCollector({ analytics });
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    first.seek({ sec: 1, nsec: 0 });
    first.close();

    const second = new AnalyticsMetricsCollector({ analytics });
    nowSpy.mockReturnValue(1_700_000_000_500);
    second.seek({ sec: 1, nsec: 0 });
    second.close();
    nowSpy.mockRestore();

    const ids = logEvent.mock.calls
      .filter(([event]) => event === AppEvent.PLAYER_SEEK)
      .map(([, data]) => (data as { seek_id: number }).seek_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
