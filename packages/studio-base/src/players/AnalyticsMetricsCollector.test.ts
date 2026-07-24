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

    expect(logEvent).toHaveBeenNthCalledWith(1, AppEvent.PLAYER_SEEK, undefined);
    expect(logEvent).toHaveBeenNthCalledWith(2, AppEvent.PLAYER_SEEK_LATENCY, {
      latency_ms: 250,
      message_count: 3,
      topic_count: 11,
    });
  });
});
