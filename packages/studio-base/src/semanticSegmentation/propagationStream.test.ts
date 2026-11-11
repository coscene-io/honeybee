// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { createMockSemanticSegmentationService, createSeedDocument } from "./mockService";
import { cloneSegmentation, frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import type { FrameInstance, PropagationContext, PropagationRequest } from "./types";

async function fixture(options: { emptyUnselected?: boolean } = {}) {
  const document = createSeedDocument();
  document.videos.push({ ...document.videos[0]!, id: "other-video" });
  document.frames.push({ ...document.frames[0]!, id: "foreign-frame", videoId: "other-video" });
  const annotation = document.annotations[frameInstanceKey("frame-5", "instance-1")]!;
  annotation.polygons.push({
    ...cloneSegmentation(annotation.polygons[0]!),
    id: "unselected-Q",
    ...(options.emptyUnselected === true ? { points: [] } : {}),
  });
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  store.getState().setCurrentFrame("frame-5");
  return { service, store };
}

function result(
  frameId: string,
  context?: PropagationContext,
): FrameInstance & { context?: PropagationContext } {
  return {
    frameId,
    instanceId: "instance-1",
    version: 1,
    polygons: [
      {
        id: `stream-${frameId}`,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.1, y: 0.2 },
        ],
      },
    ],
    ...(context ? { context } : {}),
  };
}

function request(): PropagationRequest {
  return { fromFrameId: "frame-5", instanceId: "instance-1", frameCount: 2 };
}
async function acknowledgedStop(
  store: ReturnType<typeof createSemanticSegmentationStore>,
): Promise<void> {
  if (store.getState().propagation.status === "cancelled") {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => {
    const detach = store.subscribe((state) => {
      if (state.propagation.status === "cancelled") {
        detach();
        resolve();
      }
    });
  });
}

it.each([["frame-7", "frame-6", ["frame-6", "frame-7"]]] as const)(
  "SEG-ONLINE-010 stages out-of-order frames once and plays in timeline direction",
  async (late, early, expected) => {
    const { service, store } = await fixture();
    const playback: string[] = [];
    let afterFirstArrival: string | undefined;
    const detach = store.subscribe((state, previous) => {
      if (state.currentFrameId !== previous.currentFrameId && state.currentFrameId) {
        playback.push(state.currentFrameId);
      }
    });
    service.propagate = async function* (submitted) {
      yield result(late, submitted.context);
      afterFirstArrival = store.getState().currentFrameId;
      yield result(early, submitted.context);
      yield result(early, submitted.context);
    };
    await store.getState().startPropagation(request());
    expect(afterFirstArrival).toBe("frame-5");
    expect(playback).toEqual(expected);
    expect(store.getState().propagation.processedFrames).toBe(2);
    expect(store.getState().stagedOperations).toHaveLength(2);
    for (const frameId of expected) {
      expect(
        store.getState().document?.annotations[frameInstanceKey(frameId, "instance-1")]?.polygons[0]
          ?.id,
      ).toBe(`stream-${frameId}`);
    }
    detach();
    store.getState().dispose();
  },
);

it("SEG-ONLINE-016 rejects foreign frame, instance, record, video, revision, job and generation tags without staging", async () => {
  const { service, store } = await fixture();
  let submittedContext: PropagationContext | undefined;
  service.propagate = async function* (submitted) {
    submittedContext = submitted.context;
    const context = submitted.context!;
    yield result("foreign-frame", context);
    yield { ...result("frame-6", context), instanceId: "instance-2" };
    for (const change of [
      { recordId: "foreign-record" },
      { videoId: "other-video" },
      { instanceId: "instance-2" },
      { revisionId: "foreign-revision" },
      { requestId: "other-job" },
      { generation: context.generation + 1 },
      { fromFrameId: "frame-0" },
      { instanceIds: ["instance-2"] },
      { seedSnapshotId: "other-seeds" },
    ]) {
      yield result("frame-6", { ...context, ...change });
    }
    yield result("frame-6");
    yield result("frame-9", context);
  };
  const before = store.getState().document;
  await store.getState().startPropagation(request());
  expect(submittedContext).toMatchObject({
    recordId: "record-1",
    videoId: "video-1",
    instanceId: "instance-1",
    fromFrameId: "frame-5",
    revisionId: "revision-0",
    requestId: expect.any(String),
    generation: expect.any(Number),
  });
  expect(store.getState().document).toEqual(before);
  expect(store.getState().currentFrameId).toBe("frame-5");
  expect(store.getState().stagedOperations).toHaveLength(0);
  expect(store.getState().propagation.processedFrames).toBe(0);
  store.getState().dispose();
});

it("SEG-ONLINE-002 freezes I.P and J.R only and fans them out without Q", async () => {
  const { service, store } = await fixture();
  const document = store.getState().document!;
  const p = document.annotations[frameInstanceKey("frame-5", "instance-1")]!.polygons[0]!;
  const r = document.annotations[frameInstanceKey("frame-5", "instance-2")]!.polygons[0]!;
  const seeds = [
    { instanceId: "instance-1", polygons: [cloneSegmentation(p)] },
    { instanceId: "instance-2", polygons: [cloneSegmentation(r)] },
  ];
  const propagate = jest.spyOn(service, "propagate");
  const submitted = { ...request(), seeds: cloneSegmentation(seeds) };
  const running = store.getState().startPropagation(submitted);
  submitted.seeds[0]!.polygons[0]!.points[0]!.x = 0.9;
  await running;
  expect(propagate.mock.calls[0]![0].seeds).toEqual(seeds);
  expect(propagate.mock.calls[0]![0].seedPolygons).toEqual([p]);
  expect(propagate.mock.calls[0]![0].context?.instanceIds).toEqual(["instance-1", "instance-2"]);
  expect(store.getState().propagation.processedFrames).toBe(2);
  expect(store.getState().stagedOperations).toHaveLength(4);
  for (const frameId of ["frame-6", "frame-7"]) {
    expect(
      store
        .getState()
        .document?.annotations[
          frameInstanceKey(frameId, "instance-1")
        ]?.polygons.map((polygon) => polygon.id),
    ).toEqual([`${p.id}@${frameId}`]);
    expect(
      store
        .getState()
        .document?.annotations[
          frameInstanceKey(frameId, "instance-2")
        ]?.polygons.map((polygon) => polygon.id),
    ).toEqual([`${r.id}@${frameId}`]);
  }
  store.getState().dispose();
});

it("deduplicates each frame-instance while counting a multi-instance frame once", async () => {
  const { service, store } = await fixture();
  const seeds = ["instance-1", "instance-2"].map((instanceId) => ({
    instanceId,
    polygons: [
      store.getState().document!.annotations[frameInstanceKey("frame-5", instanceId)]!.polygons[0]!,
    ],
  }));
  service.propagate = async function* (submitted) {
    yield result("frame-7", submitted.context);
    yield { ...result("frame-7", submitted.context), instanceId: "instance-2" };
    yield result("frame-6", submitted.context);
    yield result("frame-6", submitted.context);
    yield { ...result("frame-6", submitted.context), instanceId: "instance-2" };
    yield { ...result("frame-6", submitted.context), instanceId: "instance-2" };
  };
  const playback: string[] = [];
  const detach = store.subscribe((state, previous) => {
    if (state.currentFrameId !== previous.currentFrameId && state.currentFrameId) {
      playback.push(state.currentFrameId);
    }
  });
  await store.getState().startPropagation({ ...request(), seeds });
  expect(playback).toEqual(["frame-6", "frame-7"]);
  expect(store.getState().propagation.processedFrames).toBe(2);
  expect(store.getState().stagedOperations).toHaveLength(4);
  detach();
  store.getState().dispose();
});

it("STOP keeps an already received out-of-order frame staged and never flushes old results over later edits", async () => {
  const { service, store } = await fixture();
  let release!: () => void;
  let consumed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted = new Promise<void>((resolve) => {
    consumed = resolve;
  });
  service.propagate = async function* (submitted) {
    yield result("frame-7", submitted.context);
    consumed();
    await gate;
    yield result("frame-6", submitted.context);
  };
  const running = store.getState().startPropagation(request());
  await accepted;
  expect(store.getState().currentFrameId).toBe("frame-5");
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().stopPropagation();
  await acknowledgedStop(store);
  store.getState().setCurrentFrame("frame-7");
  const edited = [
    { x: 0.3, y: 0.3 },
    { x: 0.5, y: 0.3 },
    { x: 0.3, y: 0.5 },
  ];
  store.getState().setPolygonPoints("stream-frame-7", edited);
  release();
  await running;
  expect(store.getState().currentFrameId).toBe("frame-7");
  expect(store.getState().propagation).toMatchObject({ status: "cancelled", processedFrames: 1 });
  expect(store.getState().stagedOperations).toHaveLength(2);
  expect(
    store.getState().document?.annotations[frameInstanceKey("frame-7", "instance-1")]?.polygons[0]
      ?.points,
  ).toEqual(edited);
  store.getState().dispose();
});

it("rejects further old results after the local revision changes", async () => {
  const { service, store } = await fixture();
  service.propagate = async function* (submitted) {
    yield result("frame-6", submitted.context);
    store.setState({ revisions: [{ id: "new-revision", createdAt: 0, message: "external" }] });
    yield result("frame-7", submitted.context);
  };
  await store.getState().startPropagation(request());
  await acknowledgedStop(store);
  expect(store.getState().propagation.status).toBe("cancelled");
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().currentFrameId).toBe("frame-6");
  store.getState().dispose();
});

it("keeps untagged legacy single-instance adapters compatible without claiming revision verification", async () => {
  const { service, store } = await fixture();
  service.supportsPropagationContext = false;
  service.propagate = async function* () {
    yield result("frame-6");
  };
  await store.getState().startPropagation(request());
  expect(store.getState().propagation.processedFrames).toBe(1);
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});

it("keeps a valid legacy seed while ignoring an intentional empty placeholder sibling", async () => {
  const { service, store } = await fixture({ emptyUnselected: true });
  let sent: PropagationRequest | undefined;
  service.propagate = async function* (submitted) {
    sent = submitted;
    yield result("frame-6", submitted.context);
  };
  await store.getState().startPropagation({ ...request(), frameCount: 1 });
  expect(sent?.seedPolygons).toHaveLength(1);
  expect(sent?.seedPolygons?.[0]?.id).toBe("instance-1-polygon-5");
  expect(store.getState().propagation.processedFrames).toBe(1);
  store.getState().dispose();
});

it("rejects empty, foreign-owner and unsupported multi-instance seeds before sending inference", async () => {
  const { service, store } = await fixture();
  const propagate = jest.spyOn(service, "propagate");
  await expect(store.getState().startPropagation({ ...request(), seeds: [] })).rejects.toThrow(
    "nonempty",
  );
  const p =
    store.getState().document!.annotations[frameInstanceKey("frame-5", "instance-1")]!.polygons[0]!;
  await expect(
    store
      .getState()
      .startPropagation({ ...request(), seeds: [{ instanceId: "instance-2", polygons: [p] }] }),
  ).rejects.toThrow("does not belong");
  service.supportsMultiInstanceSeeds = false;
  const seeds = ["instance-1", "instance-2"].map((instanceId) => ({
    instanceId,
    polygons: [
      store.getState().document!.annotations[frameInstanceKey("frame-5", instanceId)]!.polygons[0]!,
    ],
  }));
  await expect(store.getState().startPropagation({ ...request(), seeds })).rejects.toThrow(
    "does not support",
  );
  expect(propagate).not.toHaveBeenCalled();
  expect(store.getState().stagedOperations).toHaveLength(0);
  expect(store.getState().propagation.status).toBe("idle");
  store.getState().dispose();
});

it("ignores a stopped controller and its context after another job has completed", async () => {
  const { service, store } = await fixture();
  let release!: () => void;
  let consumed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted = new Promise<void>((resolve) => {
    consumed = resolve;
  });
  let oldContext: PropagationContext | undefined;
  let calls = 0;
  service.propagate = async function* (submitted) {
    if (++calls === 1) {
      oldContext = submitted.context;
      yield result("frame-6", submitted.context);
      consumed();
      await gate;
      yield result("frame-7", submitted.context);
    } else {
      yield result("frame-7", oldContext);
      yield result("frame-7", submitted.context);
    }
  };
  const old = store.getState().startPropagation(request());
  await accepted;
  store.getState().stopPropagation();
  await acknowledgedStop(store);
  await store.getState().startPropagation({ ...request(), fromFrameId: "frame-6", frameCount: 1 });
  const before = store.getState().document;
  release();
  await old;
  expect(store.getState().document).toEqual(before);
  expect(store.getState().currentFrameId).toBe("frame-7");
  expect(store.getState().stagedOperations).toHaveLength(2);
  expect(store.getState().propagation).toMatchObject({ status: "completed", processedFrames: 1 });
  store.getState().dispose();
});

it("keeps playback geometry ready when streamed targets cross the initial ten-second window", async () => {
  const { service, store } = await fixture();
  store.getState().setCurrentFrame("frame-49");
  const manualClass = store.getState().addClass("Keep manual work across streamed window reads");
  const reads = jest.spyOn(service, "loadFrameWindow");
  const readiness: boolean[] = [];
  const detach = store.subscribe((state, previous) => {
    if (state.currentFrameId !== previous.currentFrameId && state.currentFrameId) {
      readiness.push(state.isFrameReady(state.currentFrameId));
    }
  });
  service.propagate = async function* (submitted) {
    yield result("frame-50", submitted.context);
    yield result("frame-51", submitted.context);
  };
  await store.getState().startPropagation({ ...request(), fromFrameId: "frame-49" });
  expect(readiness).toEqual([true, true]);
  expect(store.getState().propagation.processedFrames).toBe(2);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(reads.mock.calls[0]?.slice(0, 3)).toEqual(["video-1", 10, 20]);
  expect(
    store.getState().document?.annotations[frameInstanceKey("frame-51", "instance-2")]?.polygons[0]
      ?.id,
  ).toBe("instance-2-polygon-51");
  expect(
    store.getState().document?.annotations[frameInstanceKey("frame-51", "instance-1")]?.polygons[0]
      ?.id,
  ).toBe("stream-frame-51");
  expect(store.getState().document?.classes.some((category) => category.id === manualClass)).toBe(
    true,
  );
  store.getState().submit("Commit streamed replacements beyond the first window");
  await store.getState().waitForSubmissions();
  const saved = await service.loadFrameWindow("video-1", 10, 20);
  expect(saved.annotations[frameInstanceKey("frame-51", "instance-1")]?.polygons[0]?.id).toBe(
    "stream-frame-51",
  );
  expect(saved.annotations[frameInstanceKey("frame-51", "instance-2")]?.polygons[0]?.id).toBe(
    "instance-2-polygon-51",
  );
  detach();
  store.getState().dispose();
});

it("ignores a complete window that resolves after STOP without overwriting retained drafts", async () => {
  const { service, store } = await fixture();
  store.getState().setCurrentFrame("frame-49");
  const geometryWindow = await service.loadFrameWindow("video-1", 10, 20);
  let release!: (value: typeof geometryWindow) => void;
  let began!: () => void;
  const gate = new Promise<typeof geometryWindow>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    began = resolve;
  });
  jest.spyOn(service, "loadFrameWindow").mockImplementation(async () => {
    began();
    return await gate;
  });
  service.propagate = async function* (submitted) {
    yield result("frame-51", submitted.context);
  };
  const running = store.getState().startPropagation({ ...request(), fromFrameId: "frame-49" });
  await reading;
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().isFrameReady("frame-51")).toBe(false);
  store.getState().stopPropagation();
  await acknowledgedStop(store);
  const manual = store.getState().addClass("Manual work after STOP");
  release(geometryWindow);
  await running;
  expect(store.getState().currentFrameId).toBe("frame-49");
  expect(store.getState().isFrameReady("frame-51")).toBe(false);
  expect(
    store.getState().document?.annotations[frameInstanceKey("frame-51", "instance-2")],
  ).toBeUndefined();
  expect(store.getState().document?.classes.some((category) => category.id === manual)).toBe(true);
  expect(store.getState().propagation.status).toBe("cancelled");
  store.getState().dispose();
});

it.each(["read-failed", "foreign-scope"] as const)(
  "unlocks after a %s geometry window without falsely marking inference geometry complete",
  async (failure) => {
    const { service, store } = await fixture();
    store.getState().setCurrentFrame("frame-49");
    const geometryWindow = await service.loadFrameWindow("video-1", 10, 20);
    const read = jest.spyOn(service, "loadFrameWindow");
    if (failure === "read-failed") {
      read.mockRejectedValueOnce(new Error("Mock window unavailable"));
    } else {
      read.mockResolvedValueOnce({ ...geometryWindow, videoId: "other-video" });
    }
    service.propagate = async function* (submitted) {
      yield result("frame-51", submitted.context);
    };
    await store.getState().startPropagation({ ...request(), fromFrameId: "frame-49" });
    expect(store.getState().propagation.status).toBe("failed");
    expect(store.getState().isFrameReady("frame-51")).toBe(false);
    expect(store.getState().frameWindowError).toMatchObject({
      videoId: "video-1",
      startSec: 10,
      endSec: 20,
    });
    expect(store.getState().stagedOperations).toHaveLength(1);
    expect(() => store.getState().addClass("Still editable after failed window")).not.toThrow();
    store.getState().dispose();
  },
);
