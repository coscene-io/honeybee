// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { formatRelativeTime } from "@foxglove/studio-base/util/relativeTime";

import { normalizedLogMessage } from "./conversion";
import { LogLevel, type Ros1RosgraphMsgs$Log, type Ros2RosgraphMsgs$Log } from "./types";

const origin = Object.freeze({ sec: 1_700_000_000, nsec: 500_000_000 });
const stamp = Object.freeze({ sec: 1_700_000_014, nsec: 605_000_000 });
const common = { name: "/node", msg: "message", file: "node.cc", function: "run", line: 1 };
const ros1: Ros1RosgraphMsgs$Log = {
  ...common,
  level: 2,
  header: { seq: 1, frame_id: "", stamp },
  topics: [],
};
const ros2: Ros2RosgraphMsgs$Log = { ...common, level: 20, stamp };

it.each([
  ["rosgraph_msgs/Log", ros1],
  ["ros.rosgraph_msgs.Log", ros1],
  ["rcl_interfaces/msg/Log", ros2],
  ["ros.rcl_interfaces.Log", ros2],
] as const)(
  "preserves the source timestamp and level for supported log schema %s",
  (schema, raw) => {
    const original = JSON.stringify(raw);
    const normalized = normalizedLogMessage(schema, raw);
    expect(normalized.stamp).toEqual(stamp);
    expect(normalized.level).toBe(LogLevel.INFO);
    expect(normalized.message).toBe("message");
    expect(formatRelativeTime(normalized.stamp, origin)).toBe("00:00:14.105");
    expect(JSON.stringify(raw)).toBe(original);
  },
);
