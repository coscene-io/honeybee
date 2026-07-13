/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { AmplitudeAnalytics } from "@foxglove/studio-base/services/AmplitudeAnalytics";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { sanitizeMessageCacheCaptureResult } from "@foxglove/studio-base/services/messageCacheTelemetry";

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
});
