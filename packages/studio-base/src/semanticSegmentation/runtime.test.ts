/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "./maskGeometry";
import {segmentationSession} from "./runtime";
import { frameInstanceKey } from "./service";
import { createMockSegmentationRuntime } from "./testing/mockRuntime";
import { createSeedDocument, setMockControls } from "./testing/mockService";

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
    const runtime = createMockSegmentationRuntime(document);
    setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0 });
    await runtime.initialize();
    const seek = jest.fn();
    segmentationSession.setState({ seek });
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
      segmentationSession.setState({ seek: undefined });
      runtime.dispose();
    }
  },
);
