// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

import { MessageSyncCoordinator } from "./MessageSyncCoordinator";

function message(topic: string, timestamp: bigint): MessageEvent {
  return {
    topic,
    receiveTime: fromNanoSec(timestamp),
    schemaName: "foxglove.CompressedVideo",
    message: { timestamp: fromNanoSec(timestamp) },
    sizeInBytes: 0,
  };
}

describe("MessageSyncCoordinator", () => {
  it("advances to the latest complete set while reporting a newer incomplete timestamp", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));

    coordinator.push(fromNanoSec(0n), message("/left", 0n));
    coordinator.push(fromNanoSec(0n), message("/right", 0n));
    expect(coordinator.resolve()).toMatchObject({ found: true, timestamp: fromNanoSec(0n) });

    coordinator.push(fromNanoSec(1n), message("/left", 1n));
    coordinator.push(fromNanoSec(2n), message("/left", 2n));
    expect(coordinator.resolve()).toMatchObject({
      found: true,
      timestamp: fromNanoSec(0n),
      waiting: {
        timestamp: fromNanoSec(2n),
        presentTopics: ["/left"],
        missingTopics: ["/right"],
      },
    });

    coordinator.push(fromNanoSec(1n), message("/right", 1n));
    expect(coordinator.resolve()).toMatchObject({
      found: true,
      timestamp: fromNanoSec(1n),
      waiting: {
        timestamp: fromNanoSec(2n),
        presentTopics: ["/left"],
        missingTopics: ["/right"],
      },
    });

    coordinator.push(fromNanoSec(2n), message("/right", 2n));
    const result = coordinator.resolve();
    expect(result).toMatchObject({ found: true, timestamp: fromNanoSec(2n) });
    expect(result?.found === true ? result.waiting : undefined).toBeUndefined();
    expect(result?.found === true ? Array.from(result.messages.keys()) : []).toEqual([
      "/left",
      "/right",
    ]);
  });

  it("reports present and missing topics from the newest incomplete timestamp", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));
    coordinator.push(fromNanoSec(3n), message("/right", 3n));

    expect(coordinator.resolve()).toEqual({
      found: false,
      presentTopics: ["/right"],
      missingTopics: ["/left"],
    });
  });

  it("clears buffered messages when registrations change", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left"]));
    coordinator.push(fromNanoSec(1n), message("/left", 1n));
    expect(coordinator.resolve()?.found).toBe(true);

    coordinator.setRegistrations(new Set(["/right"]));
    expect(coordinator.resolve()).toEqual({
      found: false,
      presentTopics: [],
      missingTopics: ["/right"],
    });
  });

  it("starts a new timestamp epoch when physical message order moves backwards", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));
    coordinator.push(fromNanoSec(100n), message("/left", 100n));
    coordinator.push(fromNanoSec(100n), message("/right", 100n));
    expect(coordinator.resolve()).toMatchObject({ found: true, timestamp: fromNanoSec(100n) });
    const previousRegressionCount = coordinator.regressionCount();

    coordinator.push(fromNanoSec(1n), message("/left", 1n));
    expect(coordinator.regressionCount()).toBe(previousRegressionCount + 1);
    expect(coordinator.resolve()).toEqual({
      found: false,
      presentTopics: ["/left"],
      missingTopics: ["/right"],
    });

    coordinator.push(fromNanoSec(1n), message("/right", 1n));
    expect(coordinator.resolve()).toMatchObject({ found: true, timestamp: fromNanoSec(1n) });
  });

  it("preserves new-epoch messages while the remaining topics cross the boundary", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));
    coordinator.push(fromNanoSec(100n), message("/left", 100n));
    coordinator.push(fromNanoSec(100n), message("/right", 100n));
    const previousRegressionCount = coordinator.regressionCount();

    coordinator.push(fromNanoSec(1n), message("/left", 1n));
    coordinator.push(fromNanoSec(100n), message("/right", 100n));
    coordinator.push(fromNanoSec(1n), message("/right", 1n));

    expect(coordinator.regressionCount()).toBe(previousRegressionCount + 1);
    expect(coordinator.resolve()).toMatchObject({ found: true, timestamp: fromNanoSec(1n) });
  });

  it("does not restart an epoch transition for a topic without an earlier baseline", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));

    coordinator.push(fromNanoSec(100n), message("/left", 100n));
    const previousRegressionCount = coordinator.regressionCount();
    coordinator.push(fromNanoSec(1n), message("/left", 1n));
    coordinator.push(fromNanoSec(100n), message("/right", 100n));
    coordinator.push(fromNanoSec(1n), message("/right", 1n));
    coordinator.push(fromNanoSec(2n), message("/left", 2n));
    coordinator.push(fromNanoSec(2n), message("/right", 2n));

    expect(coordinator.regressionCount()).toBe(previousRegressionCount + 1);
    expect(coordinator.resolve()).toMatchObject({ found: true, timestamp: fromNanoSec(2n) });
  });

  it("retains at most 250 timestamp buckets", () => {
    const coordinator = new MessageSyncCoordinator();
    coordinator.setRegistrations(new Set(["/left", "/right"]));
    for (let timestamp = 1n; timestamp <= 251n; timestamp++) {
      coordinator.push(fromNanoSec(timestamp), message("/left", timestamp));
    }

    coordinator.push(fromNanoSec(1n), message("/right", 1n));
    expect(coordinator.resolve()).toEqual({
      found: false,
      presentTopics: ["/left"],
      missingTopics: ["/right"],
    });
  });
});
