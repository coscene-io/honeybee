// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService, createSeedDocument } from "./mockService";
import type { PropagationResult } from "./types";

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

it("rejects backward propagation because the contract only moves to later frames", async () => {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const frames: PropagationResult[] = [];
  const stream = service.propagate(
    {
      instanceId: "instance-1",
      fromFrameId: "frame-10",
      direction: "backward",
      frameCount: 1,
      seedPolygons: [
        {
          id: "instance-1-polygon-10",
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.4, y: 0.2 },
            { x: 0.4, y: 0.4 },
          ],
        },
      ],
    },
    new AbortController().signal,
  );
  await expect(async () => {
    for await (const frame of stream) {
      frames.push(frame);
    }
  }).rejects.toThrow(/later source frames/);
  expect(frames).toEqual([]);
});
