// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService, createSeedDocument } from "./mockService";

it("stores the workshop seed as one commit shared by both camera topics", () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const commit = service.contractCommits[0]?.commit;
  const topics = new Set(commit?.frames.map((frame) => frame.topic));
  expect(topics).toEqual(new Set(["/camera/front", "/camera/side"]));
  for (const frame of commit?.frames ?? []) {
    for (const annotation of frame.annotations) {
      for (const polygon of annotation.polygons.polygons) {
        expect(polygon).not.toHaveProperty("topic");
      }
    }
  }
  expect(new Set(commit?.catalog.instances.map((instance) => instance.class)).size).toBeLessThan(
    commit?.catalog.instances.length ?? 0,
  );
  const front = commit?.frames.find(
    (frame) => frame.topic === "/camera/front" && frame.frameIndex === "0",
  );
  expect(front?.annotations[0]?.polygons.polygons[0]?.points[0]?.x).toBeCloseTo(0.17 * 960);
  expect(service.contractCommits[0]?.commit.baseCommit).toContain("/commits/genesis");
  const document = createSeedDocument();
  expect(document.instances.map((instance) => instance.id)).toContain("instance-1");
  expect(document.videos.map((video) => video.id)).toEqual(["video-1", "video-side"]);
});
