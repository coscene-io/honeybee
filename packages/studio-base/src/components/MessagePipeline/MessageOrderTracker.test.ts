// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { MessageEvent, PlayerPresence, PlayerState } from "@foxglove/studio-base/players/types";
import { VideoDiagnostics } from "@foxglove/studio-base/services/videoDiagnostics";

import MessageOrderTracker from "./MessageOrderTracker";

let lastSeekTimeCounter = 1;
const lastSeekTime = () => {
  lastSeekTimeCounter += 1;
  return lastSeekTimeCounter;
};

const playerStateWithMessages = (messages: any): PlayerState => ({
  presence: PlayerPresence.PRESENT,
  progress: {},
  capabilities: [],
  playerId: "test",
  profile: undefined,
  activeData: {
    topics: [
      { name: "/foo", schemaName: "visualization_msgs/Marker" },
      { name: "/bar", schemaName: "visualization_msgs/Marker" },
    ],
    topicStats: new Map(),
    datatypes: new Map(),
    currentTime: {
      sec: 1,
      nsec: 11,
    },
    speed: 0.2,
    lastSeekTime: lastSeekTime(),
    startTime: { sec: 0, nsec: 0 },
    endTime: { sec: 2, nsec: 0 },
    isPlaying: true,
    repeatEnabled: false,
    messages,
    totalBytesReceived: 1234,
  },
});

const message = (
  headerStampSeconds: number | undefined,
  receiveTimeSeconds: number,
): MessageEvent => ({
  topic: "/foo",
  // `MessageEvent.receiveTime` is always a concrete `Time` (never optional), so unlike
  // `headerStampSeconds` below, `receiveTimeSeconds` must always be provided.
  receiveTime: { sec: receiveTimeSeconds, nsec: 1 },
  message: {
    header:
      headerStampSeconds == undefined ? undefined : { stamp: { sec: headerStampSeconds, nsec: 1 } },
  },
  schemaName: "visualization_msgs/Marker",
  sizeInBytes: 0,
});

describe("MessagePipeline/MessageOrderTracker", () => {
  it("retains cross-topic order evidence and ignores a seek backfill or a repeated batch", () => {
    const session = new VideoDiagnostics();
    const tracker = new MessageOrderTracker(session);
    const previous = { ...message(7, 10), topic: "/bar" };
    const state = playerStateWithMessages([previous, message(8, 9)]);
    expect(tracker.update(state)).toEqual([
      {
        severity: "warn",
        message: "Data went back in time",
        error: expect.objectContaining({ message: expect.stringMatching(/on \/foo.*on \/bar/) }),
      },
    ]);
    expect(tracker.update(state)).toEqual([]);
    const group = session.topics.get("/foo")?.findings.get("order");
    expect(Array.from(group!.values())).toEqual([
      {
        kind: "order",
        topic: "/foo",
        otherTopic: "/bar",
        start: 9000000001n,
        end: 10000000001n,
        duration: 1,
      },
    ]);
    const backfill = playerStateWithMessages([message(1, 2), message(1, 1)]);
    expect(tracker.update(backfill)).toEqual([
      expect.objectContaining({ message: "Data went back in time" }),
    ]);
    expect(group?.size).toBe(1);
  });

  it("accepts monotonic delivery and equal record times", () => {
    const session = new VideoDiagnostics();
    const tracker = new MessageOrderTracker(session);
    tracker.update(playerStateWithMessages([message(8, 9), message(7, 9), message(6, 10)]));
    tracker.dispose();
    expect(session.topics.size).toBe(0);
  });
});
