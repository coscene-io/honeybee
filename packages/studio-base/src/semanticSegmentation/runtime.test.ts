/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "./maskGeometry";
import { createSegmentationRuntime } from "./runtime";
import { createSegmentationHost } from "./segmentationHost";
import { frameInstanceKey } from "./service";
import { createMockSegmentationRuntime } from "./testing/mockRuntime";
import {
  createMockSemanticSegmentationService,
  createSeedDocument,
  setMockControls,
} from "./testing/mockService";

it("appends real message/camera metadata without losing drafts or committed geometry", async () => {
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  const document = runtime.store.getState().document!;
  const frameCount = document.frames.length;
  const videoCount = document.videos.length;
  const original = document.videos[0]!;
  const second = { ...original, id: "rear-camera", name: "rear camera" };
  const frame = {
    id: "actual-message-123",
    videoId: second.id,
    index: 0,
    timestampSec: 0.65,
    logTimeNs: "1700000000650000000",
    imageUrl: "",
  };
  const classId = runtime.store.getState().addClass("shared camera class");
  runtime.registerSource({ videos: [second], frames: [frame] });
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  runtime.store.getState().setCurrentFrame(frame.id);
  await runtime.store.getState().loadFrameWindow(second.id, 0, 1);
  const instanceId = runtime.store.getState().addInstance(classId);
  const polygonId = runtime.store.getState().addPolygon(instanceId, [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.1 },
    { x: 0.1, y: 0.2 },
  ]);
  runtime.store.getState().submit("new actual frame");
  await runtime.store.getState().waitForSubmissions();
  const frameWindow = await runtime.service.loadFrameWindow(second.id, 0, 1);
  expect(polygonsOf(frameWindow.annotations[frameInstanceKey(frame.id, instanceId)])[0]?.id).toBe(
    polygonId,
  );
  expect(runtime.store.getState().document?.videos).toHaveLength(videoCount + 1);
  expect(runtime.store.getState().document?.frames).toHaveLength(frameCount + 1);
  expect(() => {
    runtime.registerSource({ videos: [], frames: [{ ...frame, timestampSec: 0.7 }] });
  }).toThrow("Conflicting source frame metadata");
  expect(() => {
    runtime.registerSource({ videos: [{ ...second, recordId: "other" }], frames: [] });
  }).toThrow("different record");
  runtime.dispose();
});

it("ignores a re-registered source that adds nothing, so a rendered frame does not render again", async () => {
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  const original = runtime.store.getState().document!.videos[0]!;
  const second = { ...original, id: "rear-camera", name: "rear camera" };
  const frame = {
    id: "actual-message-456",
    videoId: second.id,
    index: 0,
    timestampSec: 0.65,
    logTimeNs: "1700000000650000000",
    imageUrl: "",
  };
  runtime.registerSource({ videos: [second], frames: [frame] });
  const update = jest.spyOn(runtime.service, "updateSourceMetadata");
  const listener = jest.fn();
  const unsubscribe = runtime.store.subscribe(listener);
  const document = runtime.store.getState().document;

  // What an Image panel registers again on each zoom or pan render of the same image.
  runtime.registerSource({ videos: [{ ...second }], frames: [{ ...frame }] });
  expect(listener).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(runtime.store.getState().document).toBe(document);

  // A longer video, a new decoded size and a new frame still publish.
  runtime.registerSource({ videos: [{ ...second, width: 640, height: 480 }], frames: [] });
  expect(runtime.store.getState().document?.videos.find((v) => v.id === second.id)?.width).toBe(
    640,
  );
  const next = { ...frame, id: "actual-message-457", timestampSec: 0.7 };
  runtime.registerSource({ videos: [], frames: [next] });
  expect(runtime.store.getState().document?.frames.some((item) => item.id === next.id)).toBe(true);
  expect(update).toHaveBeenCalledTimes(2);
  // Conflicts are still rejected rather than skipped as known frames.
  expect(() => {
    runtime.registerSource({ videos: [], frames: [{ ...next, timestampSec: 0.8 }] });
  }).toThrow("Conflicting source frame metadata");
  unsubscribe();
  runtime.dispose();
});

it.each(["forward", "backward"] as const)(
  "seeks to the last %s result as soon as a burst of results ends",
  async (direction) => {
    const document = createSeedDocument();
    const seek = jest.fn();
    const runtime = createMockSegmentationRuntime(document, { seek });
    setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0 });
    await runtime.initialize();
    try {
      const { store } = runtime;
      store.getState().setCurrentFrame("frame-20");
      const frames = store.getState().document!.frames;
      const last = direction === "forward" ? "frame-25" : "frame-15";
      await store.getState().startPropagation({
        instanceId: "instance-1",
        fromFrameId: "frame-20",
        endTimeNs: frames.find((frame) => frame.id === last)!.logTimeNs,
      });
      expect(store.getState().propagation.status).toBe("completed");
      // No timer has run: the final seek must not wait for the one-per-second throttle.
      expect(seek).toHaveBeenLastCalledWith(
        BigInt(frames.find((frame) => frame.id === last)!.logTimeNs),
      );
    } finally {
      runtime.dispose();
    }
  },
);

it("wraps the service without changing it, and publishes each change once, projected", async () => {
  const document = createSeedDocument();
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const methods = () => [Reflect.get(service, "loadDocument"), Reflect.get(service, "submit")];
  const original = methods();
  const first = createSegmentationRuntime(service, document);
  const second = createSegmentationRuntime(service, document);
  // Two runtimes over one service: neither patches it, so neither wraps the other's wrapper.
  expect(methods()).toEqual(original);
  expect(methods()[0]).toBe(original[0]);
  second.dispose();
  await first.initialize();
  const published = first.store.getState().document!;
  const frames = published.frames;
  const framesBefore = [...frames];
  const seen: (typeof published)[] = [];
  // Each document a subscriber sees; an unprojected one republished from a listener shows twice.
  const unsubscribe = first.store.subscribe((state, previous) => {
    if (state.document !== previous.document) {
      seen.push(state.document!);
    }
  });
  const frame = {
    id: "registered-later",
    videoId: "video-1",
    index: 0,
    timestampSec: 0.3,
    logTimeNs: "1700000000300000000",
    imageUrl: "",
  };
  first.registerSource({ videos: [], frames: [frame] });
  expect(seen).toHaveLength(1);
  expect(seen[0]!.frames.some((item) => item.id === frame.id)).toBe(true);
  // The previously published table is not changed in place.
  expect(frames).toEqual(framesBefore);
  // A staged edit is one update that already carries the registered frame.
  first.store.getState().addClass("Once");
  expect(seen).toHaveLength(2);
  expect(seen[1]!.frames).toBe(seen[0]!.frames);
  unsubscribe();
  first.dispose();
});

it("remembers the creation tool through the injected setting", async () => {
  let stored: unknown = "quick";
  const set = jest.fn((tool: unknown) => {
    stored = tool;
  });
  const document = createSeedDocument();
  const runtime = createSegmentationRuntime(
    createMockSemanticSegmentationService({ document, controls: { delayMs: 0, streamDelayMs: 0 } }),
    document,
    { creationToolSetting: { get: () => stored, set } },
  );
  expect(runtime.store.getState().creationTool).toBe("quick");
  runtime.store.getState().setCreationTool("polygon");
  expect(set).toHaveBeenCalledWith("polygon");
  expect(stored).toBe("polygon");
  runtime.dispose();
});

describe("runtime registry", () => {
  let host = createSegmentationHost();
  beforeEach(() => {
    host = createSegmentationHost();
  });
  afterEach(() => {
    host.dispose();
  });
  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  function tracked() {
    const document = createSeedDocument();
    const runtime = createSegmentationRuntime(
      createMockSemanticSegmentationService({
        document,
        controls: { delayMs: 0, streamDelayMs: 0 },
      }),
      document,
    );
    const dispose = jest.spyOn(runtime, "dispose");
    return { runtime, dispose };
  }

  it("disposes a runtime when its last panel lets go, and clears the session's references", async () => {
    const { runtime, dispose } = tracked();
    expect(host.registry.acquire("record-a", "panel-1", () => runtime).created).toBe(true);
    expect(host.registry.acquire("record-a", "panel-2", jest.fn()).runtime).toBe(runtime);
    host.session.setState({ runtime, previewRuntime: runtime, open: true });
    host.registry.release("panel-1");
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    host.registry.release("panel-2");
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.session.getState()).toMatchObject({
      runtime: undefined,
      previewRuntime: undefined,
      open: false,
    });
    expect(host.registry.heldCount()).toBe(0);
  });

  it("keeps a runtime for a panel that remounts in the same commit", async () => {
    const { runtime, dispose } = tracked();
    host.registry.acquire("record-b", "panel-1", () => runtime);
    host.registry.release("panel-1");
    expect(host.registry.acquire("record-b", "panel-1", jest.fn()).runtime).toBe(runtime);
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    host.registry.release("panel-1");
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the previous record when a panel moves to another one", async () => {
    const first = tracked();
    const second = tracked();
    host.registry.acquire("record-c", "panel-1", () => first.runtime);
    host.registry.acquire("record-d", "panel-1", () => second.runtime);
    await flush();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    host.registry.release("panel-1");
    await flush();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps unsaved work until it is saved, then disposes the runtime", async () => {
    const { runtime, dispose } = tracked();
    host.registry.acquire("record-e", "panel-1", () => runtime);
    await runtime.initialize();
    runtime.store.getState().addClass("Unsaved");
    host.registry.release("panel-1");
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    expect(host.registry.heldCount()).toBe(1);
    runtime.store.getState().submit();
    await runtime.store.getState().waitForSubmissions();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.registry.heldCount()).toBe(0);
  });

  it("reports unsaved work across held runtimes until it is saved", async () => {
    const { runtime } = tracked();
    host.registry.acquire("record-g", "panel-1", () => runtime);
    await runtime.initialize();
    expect(host.registry.hasUnsavedWork()).toBe(false);
    runtime.store.getState().addClass("Unsaved");
    expect(host.registry.hasUnsavedWork()).toBe(true);
    runtime.store.getState().submit();
    await runtime.store.getState().waitForSubmissions();
    expect(host.registry.hasUnsavedWork()).toBe(false);
    host.registry.release("panel-1");
    await flush();
  });

  it("shares one runtime between two panels and creates it once", () => {
    const { runtime } = tracked();
    const create = jest.fn(() => runtime);
    const first = host.registry.acquire("record-h", "panel-1", create);
    const second = host.registry.acquire("record-h", "panel-2", create);
    expect(second.runtime).toBe(first.runtime);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("disposes every runtime when the host goes away, unsaved work included", async () => {
    const { runtime, dispose } = tracked();
    host.registry.acquire("record-i", "panel-1", () => runtime);
    await runtime.initialize();
    runtime.store.getState().addClass("Unsaved");
    host.session.setState({ runtime, open: true });
    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.registry.heldCount()).toBe(0);
    expect(host.session.getState()).toMatchObject({ runtime: undefined, open: false });
  });

  it("keeps hosts apart: a runtime held by one is unknown to another", () => {
    const other = createSegmentationHost();
    const { runtime } = tracked();
    host.registry.acquire("record-j", "panel-1", () => runtime);
    expect(other.registry.heldCount()).toBe(0);
    expect(other.registry.hasUnsavedWork()).toBe(false);
    other.dispose();
  });

  it("gives a returning panel the runtime that held unsaved work", async () => {
    const { runtime, dispose } = tracked();
    host.registry.acquire("record-f", "panel-1", () => runtime);
    await runtime.initialize();
    runtime.store.getState().addClass("Unsaved");
    host.registry.release("panel-1");
    await flush();
    expect(host.registry.acquire("record-f", "panel-2", jest.fn())).toEqual({
      runtime,
      created: false,
    });
    runtime.store.getState().submit();
    await runtime.store.getState().waitForSubmissions();
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    host.registry.release("panel-2");
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

it("forwards the service's methods to the store", async () => {
  const document = createSeedDocument();
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const segmentFrame = jest.fn(async () => ({ mask: undefined, score: 0 }));
  service.segmentFrame = segmentFrame;
  const runtime = createSegmentationRuntime(service, document);
  expect(runtime.store.getState().supportsInstanceMerge).toBe(service.supportsInstanceMerge);
  await runtime.store
    .getState()
    .segmentFrame({ topic: "t", logTimeNs: "1", width: 1, height: 1, imageUrl: "", points: [] });
  expect(segmentFrame).toHaveBeenCalledTimes(1);
  runtime.dispose();
});
