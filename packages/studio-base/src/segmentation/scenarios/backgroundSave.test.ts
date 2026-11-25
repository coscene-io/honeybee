// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "../maskGeometry";
import { frameInstanceKey } from "../service";
import { createSegmentationStore } from "../store";
import { createMockSegmentationService } from "../testing/mockService";
import type { FrameWindow, NormalizedPoint } from "../types";

const triangle: NormalizedPoint[] = [
  { x: 0.12345, y: 0.2 },
  { x: 0.4, y: 0.2 },
  { x: 0.3, y: 0.6 },
];

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  const service = createMockSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

/** Holds a submit until released; the service saves only then. */
function gateSubmit(service: ReturnType<typeof createMockSegmentationService>) {
  const gate = deferred();
  const submit = service.submit.bind(service);
  service.submit = async (request) => {
    await gate.promise;
    return await submit(request);
  };
  return gate;
}

describe("a save acknowledged while a window read is in flight", () => {
  it("still loads the window, so the next frame is editable after submit then step", async () => {
    const { service, store } = await setup();
    const saved = gateSubmit(service);
    const read = deferred();
    const load = service.loadFrameWindow.bind(service);
    service.loadFrameWindow = async (videoId, startSec, endSec, signal) => {
      const result = await load(videoId, startSec, endSec, signal);
      await read.promise;
      return result;
    };
    store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("before step");
    // Step to a frame in an unloaded window, then the save lands before the read does.
    store.getState().setCurrentFrame("frame-80");
    saved.resolve();
    await store.getState().waitForSubmissions();
    read.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
    expect(store.getState().isFrameReady("frame-80")).toBe(true);
    expect(store.getState().loading).toBe(false);
    expect(() => store.getState().addPolygon("instance-1", triangle)).not.toThrow();
    store.getState().dispose();
  });

  it("keeps what the save wrote instead of the read's pre-save geometry", async () => {
    const { service, store } = await setup();
    const saved = gateSubmit(service);
    const load = service.loadFrameWindow.bind(service);
    // The server answers the read before it applies the save.
    const before = await load("video-1", 0, 10);
    const read = deferred<FrameWindow>();
    service.loadFrameWindow = async () => await read.promise;
    const polygonId = store.getState().addPolygon("instance-1", triangle);
    store.getState().submit();
    const reading = store.getState().loadFrameWindow("video-1", 0, 10);
    saved.resolve();
    await store.getState().waitForSubmissions();
    read.resolve(before);
    await reading;
    const annotation =
      store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")];
    expect(polygonsOf(annotation).some((polygon) => polygon.id === polygonId)).toBe(true);
    expect(store.getState().isFrameReady("frame-0")).toBe(true);
    store.getState().dispose();
  });
});

describe("window reads are the authority for their frames", () => {
  it("drops an observation the server deleted since the frame was loaded", async () => {
    const { service, store } = await setup();
    const deletedKey = frameInstanceKey("frame-0", "instance-1");
    expect(store.getState().document!.annotations[deletedKey]).toBeDefined();
    const load = service.loadFrameWindow.bind(service);
    service.loadFrameWindow = async (videoId, startSec, endSec, signal) => {
      const result = await load(videoId, startSec, endSec, signal);
      const { [deletedKey]: _deleted, ...annotations } = result.annotations;
      return { ...result, annotations };
    };
    await store.getState().loadFrameWindow("video-1", 0, 10);
    expect(store.getState().document!.annotations[deletedKey]).toBeUndefined();
    expect(store.getState().document!.annotationSummaries[deletedKey]).toBeUndefined();
    store.getState().dispose();
  });

  it("re-reads loaded windows after initialize instead of trusting old geometry", async () => {
    const { service, store } = await setup();
    await store.getState().loadFrameWindow("video-1", 20, 24);
    expect(store.getState().isFrameReady("frame-119")).toBe(true);
    const load = jest.spyOn(service, "loadFrameWindow");
    await store.getState().initialize();
    // The current frame is read again at once; other windows when they are next needed.
    expect(load).toHaveBeenCalledWith("video-1", 0, 10, expect.any(AbortSignal));
    expect(store.getState().isFrameReady("frame-0")).toBe(true);
    expect(store.getState().isFrameReady("frame-119")).toBe(false);
    // Geometry stays shown meanwhile.
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-119", "instance-1")],
    ).toBeDefined();
    store.getState().dispose();
  });
});

describe("a save acknowledged while propagation runs", () => {
  it("does not stop the run", async () => {
    const { service, store } = await setup();
    const saved = gateSubmit(service);
    const firstConsumed = deferred();
    const resume = deferred();
    const source =
      store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!;
    service.propagate = async function* (request) {
      yield { ...source, frameId: "frame-1", context: request.context };
      firstConsumed.resolve();
      await resume.promise;
      yield { ...source, frameId: "frame-2", context: request.context };
    };
    store.getState().renameClass("class-1", "Saved first");
    store.getState().submit();
    const running = store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      endTimeNs: "1700000000400000000",
    });
    await firstConsumed.promise;
    saved.resolve();
    await store.getState().waitForSubmissions();
    expect(store.getState().propagation.status).toBe("running");
    resume.resolve();
    await running;
    expect(store.getState().propagation.status).toBe("completed");
    expect(store.getState().propagation.processedFrames).toBe(2);
    expect(store.getState().document!.classes.find((item) => item.id === "class-1")?.name).toBe(
      "Saved first",
    );
    store.getState().dispose();
  });
});

it("undoes a whole propagation run in one step", async () => {
  const { store } = await setup();
  const staged = store.getState().stagedOperations.length;
  await store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-0",
    endTimeNs: "1700000001000000000",
  });
  expect(store.getState().propagation.processedFrames).toBe(5);
  expect(store.getState().stagedOperations).toHaveLength(staged + 5);
  store.getState().undo();
  expect(store.getState().stagedOperations).toHaveLength(staged);
  store.getState().redo();
  expect(store.getState().stagedOperations).toHaveLength(staged + 5);
  store.getState().dispose();
});
