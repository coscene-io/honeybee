// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { distinctTopicLabels, segmentationCameraLabel } from "./cameraLabels";

function labels(topics: string[]): string[] {
  const map = distinctTopicLabels(topics);
  return topics.map((topic) => map.get(topic) ?? "<none>");
}

describe("distinctTopicLabels", () => {
  it("keeps the part that differs at the front", () => {
    expect(
      labels([
        "/cam_head/compressed/h265",
        "/cam_wrist_left/compressed/h265",
        "/cam_wrist_right/compressed/h265",
      ]),
    ).toEqual(["cam_head", "cam_wrist_left", "cam_wrist_right"]);
  });

  it("keeps the part that differs at the end", () => {
    expect(labels(["/cam/rgb", "/cam/depth"])).toEqual(["rgb", "depth"]);
  });

  it("keeps the part that differs in the middle", () => {
    expect(labels(["/cam/left/image", "/cam/right/image"])).toEqual(["left", "right"]);
    expect(
      labels([
        "/astribot_camera/head_rgbd/color_compress/compressed/h264",
        "/astribot_camera/left_wrist_rgbd/color_compress/compressed/h264",
      ]),
    ).toEqual(["head_rgbd", "left_wrist_rgbd"]);
  });

  it("keeps several differing segments together", () => {
    expect(labels(["/robot/a/x/image", "/robot/b/y/image"])).toEqual(["a/x", "b/y"]);
  });

  it("keeps the old name for a lone topic", () => {
    expect(labels(["/cam_head/compressed/h265"])).toEqual(["compressed"]);
    expect(labels(["/image"])).toEqual(["image"]);
  });

  it("widens a name that comes out empty", () => {
    expect(labels(["/cam", "/cam/depth"])).toEqual(["cam", "depth"]);
  });

  it("widens names that still collide after trimming", () => {
    const result = labels(["/a/b", "/a/b/b", "/a/c"]);
    expect(new Set(result).size).toBe(3);
    expect(result[2]).toBe("c");
  });

  it("lets differing lengths share one name only when the whole topic is reached", () => {
    const result = labels(["/x/cam/image", "/y/cam/image", "/x/cam/extra/image"]);
    expect(new Set(result).size).toBe(3);
  });

  it("gives the same name to spellings of one topic and skips empty ones", () => {
    const map = distinctTopicLabels(["/cam/a", "cam/a/", "/cam/b", "/"]);
    expect(map.get("/cam/a")).toBe("a");
    expect(map.get("cam/a/")).toBe("a");
    expect(map.get("/cam/b")).toBe("b");
    expect(map.has("/")).toBe(false);
  });
});

describe("segmentationCameraLabel", () => {
  it("names a topic among the ones shown with it", () => {
    expect(
      segmentationCameraLabel("/cam_head/compressed/h265", [
        "/cam_head/compressed/h265",
        "/cam_wrist_left/compressed/h265",
        undefined,
      ]),
    ).toBe("cam_head");
  });

  it("falls back to the generic name without a topic", () => {
    expect(segmentationCameraLabel(undefined, ["/a/b"])).toBe("Image");
  });
});
