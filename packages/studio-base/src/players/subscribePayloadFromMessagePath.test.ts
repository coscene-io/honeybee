// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subscribePayloadFromMessagePath } from "@foxglove/studio-base/players/subscribePayloadFromMessagePath";

describe("subscribePayloadFromMessagePath", () => {
  it("handles whole topic paths", () => {
    const result = subscribePayloadFromMessagePath("topic", "partial");
    expect(result).toEqual({ topic: "topic", preloadType: "partial" });
  });

  it("handles specific field paths", () => {
    const result = subscribePayloadFromMessagePath("topic.field");
    expect(result).toEqual({ topic: "topic", fields: ["field"], preloadType: "partial" });
  });

  it("handles nested field paths", () => {
    const result = subscribePayloadFromMessagePath("topic.field.subfield");
    expect(result).toEqual({ topic: "topic", fields: ["field"], preloadType: "partial" });
  });

  it("handles complex paths", () => {
    const result = subscribePayloadFromMessagePath("topic{x==1}.field[:].subfield");
    expect(result).toEqual({ topic: "topic", fields: ["field", "x"], preloadType: "partial" });
  });

  it("includes root filter dependencies before a function chain", () => {
    expect(
      subscribePayloadFromMessagePath(
        '/tf{child_frame_id=="LIDAR_TOP"}.rotation.@rpy.yaw.@degrees',
      ),
    ).toEqual({ topic: "/tf", fields: ["rotation", "child_frame_id"], preloadType: "partial" });
  });

  it("deduplicates nested root dependencies and keeps nested filters inside the selected field", () => {
    expect(
      subscribePayloadFromMessagePath(
        "/t{header.seq>0}{header.seq<10}{items.id!=0}.items[:]{id==1}.value",
        "full",
      ),
    ).toEqual({ topic: "/t", fields: ["items", "header"], preloadType: "full" });
  });

  it("keeps whole-topic subscriptions for filtered root functions", () => {
    expect(subscribePayloadFromMessagePath('/tf{child_frame_id=="LIDAR_TOP"}.@timedelta')).toEqual({
      topic: "/tf",
      preloadType: "partial",
    });
  });
});
