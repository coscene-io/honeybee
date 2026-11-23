// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "./maskGeometry";
import { applySegmentationPatches, cloneSegmentation, frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import { createMockSemanticSegmentationService, createSeedDocument } from "./testing/mockService";
import type {
  PropagationCancellation,
  PropagationResult,
  SegmentationDocument,
  SegmentationPatch,
} from "./types";

/** One source frame plus the requested target frames, using synthetic local images only. */
function createSubmissionFixture(targetFrames = 1000): SegmentationDocument {
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
        kind: "polygons",
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
  document.annotationSummaries = Object.fromEntries(
    Object.keys(document.annotations).map((key) => [key, { polygonCount: 1, pointCount: 4 }]),
  );
  return document;
}

const points = [
  { x: 0.1, y: 0.1 },
  { x: 0.3, y: 0.1 },
  { x: 0.1, y: 0.3 },
];
const key = (index: number, instanceId = "instance-1") =>
  frameInstanceKey(`submission-frame-${index}`, instanceId);
const request = {
  fromFrameId: "submission-frame-0",
  instanceId: "instance-1",
  endTimeNs: "1700000020000000000",
};

async function fixture(mode: "initial" | "preloaded" = "initial") {
  const document = createSubmissionFixture();
  for (const index of [0, 60]) {
    document.annotations[key(index, "instance-2")] = {
      frameId: `submission-frame-${index}`,
      instanceId: "instance-2",
      kind: "polygons",
      polygons: [{ id: `unselected-${index}`, points: cloneSegmentation(points) }],
    };
    document.annotationSummaries[key(index, "instance-2")] = { polygonCount: 1, pointCount: 3 };
  }
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  if (mode === "preloaded") {
    // Remove incidental window-transport timers so the consumer must yield by itself.
    await store.getState().loadFrameWindow("video-1", 10, 20);
  }
  return { service, store };
}

it("lets a timer STOP a hot 100-frame iterator before exhaustion, rejects the yielded late result and waits for terminal ack", async () => {
  const { service, store } = await fixture("preloaded");
  const before = store.getState().document!;
  const snapshot = cloneSegmentation(before);
  let acknowledge!: (value: PropagationCancellation) => void;
  let requestId: string | undefined;
  service.cancelPropagation = async (context) => {
    requestId = context.requestId;
    return await new Promise<PropagationCancellation>((resolve) => {
      acknowledge = resolve;
    });
  };
  let produced = 0;
  let cutoff = 0;
  const emitted: (PropagationResult & { kind: "polygons" })[] = [];
  service.propagate = async function* (submitted) {
    setTimeout(() => {
      cutoff = store.getState().stagedOperations.length;
      store.getState().stopPropagation();
    }, 0);
    for (let index = 1; index <= 100; index++) {
      produced++;
      const result = {
        frameId: `submission-frame-${index}`,
        instanceId: "instance-1",
        context: submitted.context,
        kind: "polygons" as const,
        polygons: [{ id: `stream-${index}`, points: cloneSegmentation(points) }],
      };
      emitted.push(result);
      yield result;
    }
  };
  await store.getState().startPropagation(request);
  expect(cutoff).toBeGreaterThan(0);
  expect(cutoff).toBeLessThan(100);
  expect(produced).toBeLessThan(100);
  expect(store.getState().stagedOperations).toHaveLength(cutoff);
  expect(store.getState().propagation).toMatchObject({
    status: "stopping",
    processedFrames: cutoff,
    cancellationPending: true,
  });
  expect(() => store.getState().addClass("Locked until terminal ack")).toThrow("Stop propagation");
  expect(before).toEqual(snapshot);
  expect(polygonsOf(store.getState().document!.annotations[key(cutoff + 1)])[0]!.id).toBe(
    `submission-polygon-${cutoff + 1}`,
  );
  const staged = cloneSegmentation(store.getState().stagedOperations);
  emitted[0]!.polygons[0]!.points[0]!.x = 0.9;
  expect(store.getState().stagedOperations).toEqual(staged);
  expect(polygonsOf(store.getState().document!.annotations[key(1)])[0]!.points).toEqual(points);
  const stopped = new Promise<void>((resolve) => {
    const detach = store.subscribe((state) => {
      if (state.propagation.status === "cancelled") {
        detach();
        resolve();
      }
    });
  });
  acknowledge({ requestId: requestId!, status: "cancelled" });
  await stopped;
  store.getState().undo();
  expect(store.getState().stagedOperations).toHaveLength(cutoff - 1);
  store.getState().dispose();
});

it("retains all 100 unique frames, complete window geometry, manual edits and undo without mutating prior overlays", async () => {
  const { service, store } = await fixture();
  const manual = store.getState().addPolygon("instance-2", points);
  const oldDocument = store.getState().document!;
  const oldSnapshot = cloneSegmentation(oldDocument);
  const oldOperations = cloneSegmentation(store.getState().stagedOperations);
  let timerAccepted: number | undefined;
  service.propagate = async function* (submitted) {
    setTimeout(() => {
      timerAccepted = store.getState().propagation.processedFrames;
    }, 0);
    for (let index = 1; index <= 100; index++) {
      yield {
        frameId: `submission-frame-${index}`,
        instanceId: "instance-1",
        context: submitted.context,
        kind: "polygons" as const,
        polygons: [{ id: `stream-${index}`, points }],
      };
    }
  };
  await store.getState().startPropagation(request);
  expect(timerAccepted).toBeLessThan(100);
  expect(store.getState().propagation).toMatchObject({ status: "completed", processedFrames: 100 });
  expect(store.getState().stagedOperations).toHaveLength(101);
  for (let index = 1; index <= 100; index++) {
    expect(polygonsOf(store.getState().document!.annotations[key(index)])).toEqual([
      { id: `stream-${index}`, points },
    ]);
  }
  expect(
    polygonsOf(store.getState().document!.annotations[key(0, "instance-2")]).map((p) => p.id),
  ).toEqual(["unselected-0", manual]);
  expect(polygonsOf(store.getState().document!.annotations[key(60, "instance-2")])[0]!.id).toBe(
    "unselected-60",
  );
  expect(store.getState().document!.annotationSummaries[key(900)]).toEqual({
    polygonCount: 1,
    pointCount: 4,
  });
  expect(oldDocument).toEqual(oldSnapshot);
  expect(store.getState().stagedOperations[0]).toEqual(oldOperations[0]);
  store.getState().undo();
  expect(polygonsOf(store.getState().document!.annotations[key(100)])[0]!.id).toBe(
    "submission-polygon-100",
  );
  expect(polygonsOf(store.getState().document!.annotations[key(99)])[0]!.id).toBe("stream-99");
  expect(
    polygonsOf(store.getState().document!.annotations[key(0, "instance-2")]).map((p) => p.id),
  ).toContain(manual);
  store.getState().dispose();
});

it("also yields during a hot flood of context-rejected results", async () => {
  const { service, store } = await fixture("preloaded");
  let produced = 0;
  let timerProduced: number | undefined;
  service.propagate = async function* (submitted) {
    setTimeout(() => {
      timerProduced = produced;
    }, 0);
    for (let index = 1; index <= 100; index++) {
      produced++;
      yield {
        frameId: `submission-frame-${index}`,
        instanceId: "instance-1",
        context: { ...submitted.context!, requestId: "foreign" },
        kind: "polygons" as const,
        polygons: [{ id: `stream-${index}`, points }],
      };
    }
  };
  const before = store.getState().document;
  await store.getState().startPropagation(request);
  expect(timerProduced).toBeGreaterThan(0);
  expect(timerProduced).toBeLessThan(100);
  expect(store.getState().stagedOperations).toHaveLength(0);
  expect(store.getState().document).toBe(before);
  store.getState().dispose();
});

it("publishes each accepted result atomically and respects a subscriber STOP before any further write", async () => {
  const { service, store } = await fixture("preloaded");
  let acknowledge!: (value: PropagationCancellation) => void;
  let requestId: string | undefined;
  service.cancelPropagation = async (context) => {
    requestId = context.requestId;
    return await new Promise<PropagationCancellation>((resolve) => {
      acknowledge = resolve;
    });
  };
  let stoppedDocument: ReturnType<typeof store.getState>["document"];
  const detach = store.subscribe((state, previous) => {
    if (state.stagedOperations.length > previous.stagedOperations.length) {
      expect(polygonsOf(state.document!.annotations[key(1)])[0]!.id).toBe("stream-1");
      expect(state.propagation.processedFrames).toBe(1);
      store.getState().stopPropagation();
      stoppedDocument = store.getState().document;
    }
  });
  service.propagate = async function* (submitted) {
    for (let index = 1; index <= 100; index++) {
      yield {
        frameId: `submission-frame-${index}`,
        instanceId: "instance-1",
        context: submitted.context,
        kind: "polygons" as const,
        polygons: [{ id: `stream-${index}`, points }],
      };
    }
  };
  await store.getState().startPropagation(request);
  expect(store.getState().document).toBe(stoppedDocument);
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().propagation.status).toBe("stopping");
  expect(store.getState().currentFrameId).toBe("submission-frame-0");
  acknowledge({ requestId: requestId!, status: "cancelled" });
  detach();
  store.getState().dispose();
});

it("replays dependent patches in order with isolated base and patch data, merges unloaded summaries and preserves tombstones", () => {
  const document = createSubmissionFixture();
  const baseSnapshot = cloneSegmentation(document);
  const patches: SegmentationPatch[] = [
    {
      instances: { created: { id: "created", classId: document.classes[0]!.id, name: "Created" } },
    },
    {
      annotations: {
        [key(1, "created")]: {
          frameId: "submission-frame-1",
          instanceId: "created",
          kind: "polygons",
          polygons: [{ id: "new", points: cloneSegmentation(points) }],
        },
      },
    },
    { instanceMerges: { "instance-1": "created" }, instances: { "instance-1": undefined } },
    {
      polygonChanges: {
        [key(1, "created")]: {
          frameId: "submission-frame-1",
          instanceId: "created",
          polygons: { new: undefined },
        },
      },
    },
  ];
  // Geometry outside loaded windows is represented only by the authoritative summaries.
  delete document.annotations[key(900)];
  delete baseSnapshot.annotations[key(900)];
  const patchSnapshot = cloneSegmentation(patches);
  const next = applySegmentationPatches(document, patches);
  expect(polygonsOf(next.annotations[key(1, "created")]).map((p) => p.id)).toEqual([
    "submission-polygon-1",
  ]);
  expect(next.annotationSummaries[key(900, "created")]).toEqual({ polygonCount: 1, pointCount: 4 });
  expect(next.annotationSummaries[key(900)]).toBeUndefined();
  expect(document).toEqual(baseSnapshot);
  expect(patches).toEqual(patchSnapshot);
  polygonsOf(next.annotations[key(1, "created")])[0]!.points[0]!.x = 0.8;
  next.instances.find((instance) => instance.id === "created")!.name = "Changed output";
  expect(document).toEqual(baseSnapshot);
  expect(patches).toEqual(patchSnapshot);
});
