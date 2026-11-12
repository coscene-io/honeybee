// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService } from "./mockService";
import { cloneSegmentation, frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import { NormalizedPoint, SegmentationDocument } from "./types";

const triangle: NormalizedPoint[] = [
  { x: 0.12345, y: 0.2 },
  { x: 0.4, y: 0.2 },
  { x: 0.3, y: 0.6 },
];
const key = frameInstanceKey("frame-0", "instance-1");

async function setup() {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

it("restores dependent grouped deltas as one undo step without submitting or mutating snapshots", async () => {
  const { service, store } = await setup();
  const submit = jest.spyOn(service, "submit");
  expect(store.getState().canRedo).toBe(false);
  store.getState().redo();
  store.getState().renameClass("class-1", "Prior edit");
  const prior = store.getState().document;
  store.getState().runTransaction("Create polygon in new instance", () => {
    const instance = store.getState().addInstance("class-2", "New instance");
    store.getState().addPolygon(instance, triangle);
  });
  const operations = store.getState().stagedOperations;
  const saved = cloneSegmentation(operations);
  const complete = store.getState().document;
  store.getState().undo();
  expect(store.getState().document).toEqual(prior);
  expect(store.getState().canRedo).toBe(true);
  store.getState().redo();
  expect(store.getState().document).toEqual(complete);
  expect(store.getState().stagedOperations).toEqual(saved);
  expect(operations).toEqual(saved);
  expect(store.getState().canRedo).toBe(false);
  expect(store.getState().submissionQueue).toEqual([]);
  expect(submit).not.toHaveBeenCalled();
  store.getState().undo();
  expect(store.getState().document).toEqual(prior);
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});

it("replays several undone commands in order and ignores empty undo/redo", async () => {
  const { store } = await setup();
  store.getState().renameClass("class-1", "First");
  store.getState().renameClass("class-1", "Second");
  store.getState().undo();
  store.getState().undo();
  store.getState().undo();
  store.getState().redo();
  expect(store.getState().document!.classes[0]!.name).toBe("First");
  expect(store.getState().canRedo).toBe(true);
  store.getState().redo();
  expect(store.getState().document!.classes[0]!.name).toBe("Second");
  expect(store.getState().canRedo).toBe(false);
  const complete = store.getState();
  store.getState().redo();
  expect(store.getState()).toBe(complete);
  store.getState().dispose();
});

it("preserves redo across navigation and unchanged window/document refreshes, including loaded geometry", async () => {
  const { store } = await setup();
  await store.getState().loadFrameWindow("video-1", 10, 20);
  store.getState().setCurrentFrame("frame-55");
  store.getState().addPolygon("instance-1", triangle);
  const complete = store.getState().document;
  const operations = store.getState().stagedOperations;
  store.getState().undo();
  const prior = store.getState().document;
  store.getState().setViewMode("original");
  store.getState().setFocus({ type: "instance", id: "instance-1" });
  store.getState().setSelection([{ type: "instance", id: "instance-1" }]);
  store.getState().setEditing(true);
  store.getState().setCurrentFrame("frame-56");
  await store.getState().loadFrameWindow("video-1", 10, 20);
  await store.getState().initialize();
  expect(store.getState().currentFrameId).toBe("frame-56");
  expect(store.getState().document).toEqual(prior);
  expect(store.getState().isFrameReady("frame-55")).toBe(true);
  expect(store.getState().canRedo).toBe(true);
  store.getState().redo();
  expect(store.getState().document).toEqual(complete);
  expect(store.getState().stagedOperations).toEqual(operations);
  expect(store.getState().editing).toBe(false);
  store.getState().dispose();
});

it("preserves current staged geometry during an unchanged document refresh", async () => {
  const { store } = await setup();
  await store.getState().loadFrameWindow("video-1", 10, 20);
  store.getState().setCurrentFrame("frame-55");
  store.getState().addPolygon("instance-1", triangle);
  const draft = store.getState().document;
  await store.getState().initialize();
  expect(store.getState().document).toEqual(draft);
  expect(store.getState().isFrameReady("frame-55")).toBe(true);
  store.getState().dispose();
});

it("invalidates redo after a new edit but retains it after a rejected edit", async () => {
  const { store } = await setup();
  store.getState().addPolygon("instance-1", triangle);
  store.getState().undo();
  expect(() => {
    store.getState().moveInstance("instance-1", "missing");
  }).toThrow("Unknown");
  expect(store.getState().canRedo).toBe(true);
  store.getState().renameClass("class-1", "New branch");
  const draft = store.getState().document;
  expect(store.getState().canRedo).toBe(false);
  store.getState().redo();
  expect(store.getState().document).toBe(draft);
  store.getState().dispose();
});

it.each(["edit", "undo", "redo", "revert"] as const)(
  "restores private redo state when a synchronous transaction fails after %s",
  async (action) => {
    const { store } = await setup();
    store.getState().renameClass("class-1", "Retained");
    store.getState().addPolygon("instance-1", triangle);
    const complete = store.getState().document;
    store.getState().undo();
    const before = store.getState();
    expect(() => {
      store.getState().runTransaction("Fail atomically", () => {
        if (action === "edit") {
          store.getState().renameClass("class-1", "Discarded");
        } else if (action === "revert") {
          store.getState().revertStaging();
        } else {
          store.getState()[action]();
        }
        throw new Error("Command failed");
      });
    }).toThrow("Command failed");
    expect(store.getState()).toBe(before);
    store.getState().redo();
    expect(store.getState().document).toEqual(complete);
    expect(store.getState().canRedo).toBe(false);
    store.getState().dispose();
  },
);

it.each(["revert", "submit"] as const)(
  "clears redo on %s even with empty staging",
  async (action) => {
    const { store } = await setup();
    store.getState().addPolygon("instance-1", triangle);
    store.getState().undo();
    if (action === "revert") {
      store.getState().revertStaging();
    } else {
      expect(store.getState().submit()).toBeUndefined();
    }
    const before = store.getState().document;
    expect(store.getState().canRedo).toBe(false);
    store.getState().redo();
    expect(store.getState().document).toBe(before);
    store.getState().dispose();
  },
);

it("submits a redone command with its original version expectations", async () => {
  const { service, store } = await setup();
  const id = store.getState().addPolygon("instance-1", triangle);
  const original = cloneSegmentation(store.getState().stagedOperations);
  store.getState().undo();
  await store.getState().loadFrameWindow("video-1", 0, 10);
  store.getState().redo();
  const submit = jest.spyOn(service, "submit");
  store.getState().submit();
  await store.getState().waitForSubmissions();
  expect(submit.mock.calls[0]![0].expectedVersions).toEqual(original[0]!.expectedVersions);
  expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
  expect(
    store.getState().document!.annotations[key]!.polygons.map((polygon) => polygon.id),
  ).toContain(id);
  expect(original[0]!.expectedVersions[key]).toBe(1);
  expect(store.getState().canRedo).toBe(false);
  store.getState().dispose();
});

it.each(["succeeded", "conflict"] as const)(
  "fences redo when an earlier queued submission returns %s",
  async (status) => {
    const { service, store } = await setup();
    const submit = service.submit.bind(service);
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    service.submit = async (request) => {
      await gate;
      return await submit(request);
    };
    if (status === "conflict") {
      service.setControls({ conflictNext: true });
    }
    store.getState().addPolygon("instance-1", triangle);
    store.getState().submit();
    store.getState().addPolygon("instance-1", triangle);
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);
    acknowledge();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe(status);
    expect(store.getState().canRedo).toBe(false);
    const before = store.getState().document;
    store.getState().redo();
    expect(store.getState().document).toBe(before);
    store.getState().dispose();
  },
);

it("clears redo when a window read discovers a changed version without rewriting staged CAS", async () => {
  const { service, store } = await setup();
  store.getState().addPolygon("instance-1", triangle);
  const original = cloneSegmentation(store.getState().stagedOperations);
  store.getState().renameClass("class-1", "Undone");
  store.getState().undo();
  service.simulateExternalEdit("frame-0", "instance-1");
  await store.getState().loadFrameWindow("video-1", 0, 10);
  expect(store.getState().canRedo).toBe(false);
  expect(store.getState().stagedOperations).toEqual(original);
  expect(store.getState().document!.versions[key]).toBeGreaterThan(
    original[0]!.expectedVersions[key]!,
  );
  store.getState().dispose();
});

it.each(["record", "revision", "source"] as const)(
  "fences redo when initialize replaces the %s context",
  async (boundary) => {
    const { service, store } = await setup();
    store.getState().addPolygon("instance-1", triangle);
    store.getState().undo();
    if (boundary === "revision") {
      await service.rollbackRevision("revision-0");
    } else if (boundary === "source") {
      const document = store.getState().document!;
      service.updateSourceMetadata!({
        videos: document.videos.map((video) => ({ ...video, durationSec: video.durationSec + 1 })),
        frames: document.frames,
      });
    } else {
      const load = service.loadDocument.bind(service);
      service.loadDocument = async () => ({
        ...(await load()),
        record: { id: "other-record", name: "Other" },
      });
    }
    await store.getState().initialize();
    expect(store.getState().canRedo).toBe(false);
    const before = store.getState().document;
    store.getState().redo();
    expect(store.getState().document).toBe(before);
    store.getState().dispose();
  },
);

it("ignores a stale document read that finishes after a submission acknowledgement", async () => {
  const { service, store } = await setup();
  const loaded = await service.loadDocument();
  let finishRead!: (document: SegmentationDocument) => void;
  service.loadDocument = async () =>
    await new Promise<SegmentationDocument>((resolve) => {
      finishRead = resolve;
    });
  const refresh = store.getState().initialize();
  store.getState().renameClass("class-1", "Committed while reading");
  store.getState().submit();
  await store.getState().waitForSubmissions();
  const committed = store.getState().document;
  finishRead(loaded);
  await refresh;
  expect(store.getState().document).toBe(committed);
  store.getState().dispose();
});

it("clears redo on revision viewing and rollback, and respects editing guards", async () => {
  const { store } = await setup();
  store.getState().addPolygon("instance-1", triangle);
  store.getState().undo();
  store.setState({ propagation: { status: "running", processedFrames: 0 } });
  expect(() => {
    store.getState().redo();
  }).toThrow("Stop propagation");
  expect(store.getState().canRedo).toBe(true);
  store.setState({ propagation: { status: "idle", processedFrames: 0 } });
  await store.getState().viewRevision("revision-0");
  expect(store.getState().canRedo).toBe(false);
  expect(() => {
    store.getState().redo();
  }).toThrow("read-only");
  await store.getState().viewRevision();
  store.getState().addPolygon("instance-1", triangle);
  store.getState().undo();
  await store.getState().rollbackRevision("revision-0");
  expect(store.getState().canRedo).toBe(false);
  store.getState().redo();
  expect(store.getState().stagedOperations).toHaveLength(0);
  store.getState().dispose();
  expect(() => {
    store.getState().redo();
  }).toThrow("disposed");
});

it("retains redo after failed document and geometry reads", async () => {
  const { service, store } = await setup();
  store.getState().addPolygon("instance-1", triangle);
  const complete = store.getState().document;
  store.getState().undo();
  jest.spyOn(service, "loadDocument").mockRejectedValueOnce(new Error("Read failed"));
  await store.getState().initialize();
  expect(store.getState().canRedo).toBe(true);
  jest.spyOn(service, "loadFrameWindow").mockRejectedValueOnce(new Error("Window failed"));
  await store.getState().loadFrameWindow("video-1", 0, 10);
  expect(store.getState().canRedo).toBe(true);
  store.getState().redo();
  expect(store.getState().document).toEqual(complete);
  store.getState().dispose();
});

it("invalidates redo when a streamed propagation result is accepted", async () => {
  const { store } = await setup();
  store.getState().renameClass("class-1", "Undone before inference");
  store.getState().undo();
  expect(store.getState().canRedo).toBe(true);
  await store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-0",
    endTimeNs: "1700000000200000000",
  });
  expect(store.getState().propagation.processedFrames).toBe(1);
  expect(store.getState().canRedo).toBe(false);
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});

it.each([false, true])("disposes silently with redo availability %s", async (withRedo) => {
  const { store } = await setup();
  if (withRedo) {
    store.getState().renameClass("class-1", "Undone before disposal");
    store.getState().undo();
  }
  const snapshot = store.getState();
  const subscriber = jest.fn();
  const unsubscribe = store.subscribe(subscriber);
  snapshot.dispose();
  snapshot.dispose();
  expect(subscriber).not.toHaveBeenCalled();
  expect(store.getState()).toBe(snapshot);
  expect(() => {
    store.getState().redo();
  }).toThrow("disposed");
  unsubscribe();
});

it("numbers new instances #N across the record and keeps counting after explicit names", async () => {
  const { store } = await setup();
  const first = store.getState().addInstance("class-1");
  const second = store.getState().addInstance("class-2");
  store.getState().addInstance("class-1", "Custom name");
  const third = store.getState().addInstance("class-1");
  const names = new Map(store.getState().document!.instances.map((item) => [item.id, item.name]));
  expect(names.get(first)).toBe("#1");
  expect(names.get(second)).toBe("#2");
  expect(names.get(third)).toBe("#3");
  store.getState().dispose();
});
