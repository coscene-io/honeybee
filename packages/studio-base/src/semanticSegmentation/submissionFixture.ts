// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import { createSeedDocument } from "./mockService";
import type { SegmentationRuntime } from "./runtime";
import { applySegmentationPatch, frameInstanceKey } from "./service";
import type { SegmentationDocument, SegmentationPatch, StagedOperation } from "./types";

/** One source frame plus the requested target frames, using synthetic local images only. */
export function createSubmissionFixture(targetFrames = 1000): SegmentationDocument {
  const document = createSeedDocument();
  document.record = { id: "local-submission-fixture", name: "1000-frame submission fixture" };
  const originalFrame = document.frames[0]!;
  document.frames = Array.from({ length: targetFrames + 1 }, (_, index) => ({
    ...originalFrame,
    id: `submission-frame-${index}`,
    index,
    timestampSec: index / 5,
    logTimeNs: String(1_700_000_000_000_000_000n + BigInt(index) * 200_000_000n),
  }));
  document.videos = document.videos.map((video) => ({
    ...video,
    recordId: document.record.id,
    durationSec: (targetFrames + 1) / 5,
  }));
  document.annotations = Object.fromEntries(
    document.frames.map((frame) => [
      frameInstanceKey(frame.id, "instance-1"),
      {
        frameId: frame.id,
        instanceId: "instance-1",
        version: 1,
        polygons: [
          {
            id: `submission-polygon-${frame.index}`,
            points: [
              { x: 0.17, y: 0.3 },
              { x: 0.32, y: 0.3 },
              { x: 0.32, y: 0.7 },
              { x: 0.17, y: 0.7 },
            ],
          },
        ],
      },
    ]),
  );
  document.versions = Object.fromEntries(Object.keys(document.annotations).map((key) => [key, 1]));
  document.annotationSummaries = Object.fromEntries(
    Object.keys(document.annotations).map((key) => [key, { polygonCount: 1, pointCount: 4 }]),
  );
  return document;
}

/** Stage one polygon edit across later frames as a single commit-sized draft. */
export async function stageSubmissionFixture(
  runtime: SegmentationRuntime,
  targetFrames = 1000,
): Promise<void> {
  await runtime.initialize();
  const store = runtime.store;
  const video = store.getState().document?.videos[0];
  if (!video) {
    throw new Error("Submission fixture has no video");
  }
  for (let start = 0; start < video.durationSec; start += 10) {
    await store
      .getState()
      .loadFrameWindow(video.id, start, Math.min(start + 10, video.durationSec));
  }
  const document = store.getState().document;
  if (!document) {
    throw new Error("Submission fixture did not load");
  }
  const polygonChanges: NonNullable<SegmentationPatch["polygonChanges"]> = {};
  const expectedVersions: Record<string, number> = {};
  for (const frame of document.frames) {
    if (frame.index < 1 || frame.index > targetFrames) {
      continue;
    }
    const key = frameInstanceKey(frame.id, "instance-1");
    const annotation = document.annotations[key];
    const polygon = annotation?.polygons[0];
    if (!annotation || !polygon) {
      throw new Error(`Missing seed polygon on ${frame.id}`);
    }
    polygonChanges[key] = {
      frameId: frame.id,
      instanceId: "instance-1",
      polygons: {
        [polygon.id]: {
          ...polygon,
          points: polygon.points.map((point) => ({ ...point, x: point.x + 0.01 })),
        },
      },
    };
    expectedVersions[key] = document.versions[key] ?? 1;
  }
  const operation: StagedOperation = {
    id: uuidv4(),
    label: "Stage submission sample",
    patch: { polygonChanges },
    expectedVersions,
  };
  store.setState({
    stagedOperations: [operation],
    document: applySegmentationPatch(document, operation.patch),
    error: undefined,
  });
}
