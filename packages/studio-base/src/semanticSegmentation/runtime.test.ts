/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSeedDocument } from "./mockService";
import { createSegmentationRuntime } from "./runtime";
import { frameInstanceKey } from "./service";

it("persists committed actual-source identities across reload and isolates a different source", async () => {
  const document = createSeedDocument();
  document.record.id = "actual-url-source";
  document.videos = document.videos.map((video) => ({ ...video, recordId: document.record.id }));
  const key = "actual-source-reload-test";
  const first = createSegmentationRuntime(document, { storageKey: key });
  first.service.setControls({ delayMs: 0 });
  await first.initialize();
  const classId = first.store.getState().addClass("persisted UUID");
  first.store.getState().submit("actual source commit");
  await first.store.getState().waitForSubmissions();
  first.dispose();
  const reload = createSegmentationRuntime(document, { storageKey: key });
  reload.service.setControls({ delayMs: 0 });
  await reload.initialize();
  expect(reload.store.getState().document?.classes.find((item) => item.id === classId)?.name).toBe(
    "persisted UUID",
  );
  const other = createSegmentationRuntime(
    {
      ...document,
      record: { id: "other-url", name: "other" },
      videos: document.videos.map((video) => ({ ...video, recordId: "other-url" })),
    },
    { storageKey: "other-source-reload-test" },
  );
  other.service.setControls({ delayMs: 0 });
  await other.initialize();
  expect(other.store.getState().document?.classes.some((item) => item.id === classId)).toBe(false);
  reload.dispose();
  other.dispose();
});

it("appends real message/camera metadata without losing drafts, committed geometry, or history", async () => {
  const runtime = createSegmentationRuntime(createSeedDocument());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const beforeRevision = await runtime.service.loadRevision("revision-0");
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
    imageUrl: "",
  };
  const classId = runtime.store.getState().addClass("shared camera class");
  runtime.registerSource({ videos: [second], frames: [frame] });
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  runtime.store.getState().setCurrentFrame(frame.id);
  await runtime.store.getState().loadFrameWindow(second.id, 0, 1);
  const instanceId = runtime.store.getState().addInstance(classId);
  const polygonId = runtime.store.getState().addPolygon(instanceId);
  runtime.store.getState().setPolygonPoints(polygonId, [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.1 },
    { x: 0.1, y: 0.2 },
  ]);
  runtime.store.getState().submit("new actual frame");
  await runtime.store.getState().waitForSubmissions();
  const frameWindow = await runtime.service.loadFrameWindow(second.id, 0, 1);
  expect(frameWindow.annotations[frameInstanceKey(frame.id, instanceId)]?.polygons[0]?.id).toBe(
    polygonId,
  );
  expect(runtime.store.getState().document?.videos).toHaveLength(videoCount + 1);
  expect(runtime.store.getState().document?.frames).toHaveLength(frameCount + 1);
  expect(await runtime.service.loadRevision("revision-0")).toEqual(beforeRevision);
  expect(() => {
    runtime.registerSource({ videos: [], frames: [{ ...frame, timestampSec: 0.7 }] });
  }).toThrow("Conflicting source frame metadata");
  expect(() => {
    runtime.registerSource({ videos: [{ ...second, recordId: "other" }], frames: [] });
  }).toThrow("different record");
  runtime.dispose();
});

it("retries a failed initial read and continues in memory when the localStorage getter throws", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage disabled");
    },
  });
  try {
    const runtime = createSegmentationRuntime(createSeedDocument(), {
      storageKey: "blocked-storage",
    });
    runtime.service.setControls({ delayMs: 0, failNext: true });
    await expect(runtime.initialize()).rejects.toThrow("Simulated service failure");
    await runtime.initialize();
    expect(runtime.store.getState().document).toBeDefined();
    expect(runtime.store.getState().error).toMatch(/storage.*unavailable/i);
    runtime.store.getState().addClass("memory draft still works");
    runtime.dispose();
  } finally {
    Object.defineProperty(window, "localStorage", descriptor);
  }
});

it("projects source metadata into an older camera history without changing historical geometry", async () => {
  const runtime = createSegmentationRuntime(createSeedDocument());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const revision = await runtime.service.loadRevision("revision-0");
  const second = {
    ...runtime.store.getState().document!.videos[0]!,
    id: "historically-absent-camera",
  };
  const frame = {
    id: "historically-absent-real-frame",
    videoId: second.id,
    index: 0,
    timestampSec: 0.7,
    imageUrl: "",
  };
  runtime.registerSource({ videos: [second], frames: [frame] });
  await runtime.store.getState().viewRevision("revision-0");
  const liveRead = jest.spyOn(runtime.service, "loadFrameWindow");
  runtime.store.getState().setCurrentFrame(frame.id);
  expect(runtime.store.getState().readonly).toBe(true);
  expect(runtime.store.getState().document?.frames.some((item) => item.id === frame.id)).toBe(true);
  expect(
    Object.values(runtime.store.getState().document!.annotations).some(
      (item) => item.frameId === frame.id,
    ),
  ).toBe(false);
  expect(liveRead).not.toHaveBeenCalled();
  expect(await runtime.service.loadRevision("revision-0")).toEqual(revision);
  runtime.dispose();
});

it("forwards the rollback CAS head through the actual runtime service wrapper", async () => {
  const runtime = createSegmentationRuntime(createSeedDocument());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const oldHead = runtime.store.getState().revisions[0]!.id;
  await runtime.service.submit({
    id: "advance-runtime-head",
    message: "Newer work",
    operations: [],
    expectedVersions: {},
  });
  await expect(runtime.service.rollbackRevision("revision-0", oldHead)).rejects.toThrow(
    "版本并发冲突",
  );
  expect((await runtime.service.listRevisions())[0]?.message).toBe("Newer work");
  runtime.dispose();
});
