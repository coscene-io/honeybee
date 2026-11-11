// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService } from "./mockService";
import { frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import { NormalizedPoint } from "./types";

/** Mock propagation moves points right/down by 10px per frame on a 960x540 frame. */
const shifted = (points: NormalizedPoint[], steps: number): NormalizedPoint[] =>
  points.map((point) => ({ x: point.x + (steps * 10) / 960, y: point.y + (steps * 10) / 540 }));

const triangle: NormalizedPoint[] = [
  { x: 0.12345, y: 0.2 },
  { x: 0.4, y: 0.2 },
  { x: 0.3, y: 0.6 },
];
const key = frameInstanceKey("frame-0", "instance-1");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

describe("semantic segmentation state", () => {
  it("creates stable empty tree nodes, preserves float coordinates and undoes local changes", async () => {
    const { store } = await setup();
    const classId = store.getState().addClass("  Tool  ");
    expect(store.getState().addClass("Tool")).toBe(classId);
    const instanceId = store.getState().addInstance(classId);
    const polygonId = store.getState().addPolygon(instanceId);
    const annotationKey = frameInstanceKey("frame-0", instanceId);
    expect(store.getState().document!.annotations[annotationKey]!.polygons).toEqual([
      { id: polygonId, points: [], topic: "/camera/front" },
    ]);
    store.getState().setPolygonPoints(polygonId, triangle);
    expect(store.getState().document!.annotations[annotationKey]!.polygons[0]!.points).toEqual(
      triangle,
    );
    expect(() => {
      store.getState().setPolygonPoints(polygonId, [{ x: NaN, y: 0 }]);
    }).toThrow("normalized");
    store.getState().undo();
    expect(store.getState().document!.annotations[annotationKey]!.polygons[0]!.points).toEqual([]);
    store.getState().setDrawingPolygonId(undefined);
    expect(store.getState().document!.annotations[annotationKey]!.polygons[0]!.id).toBe(polygonId);
    store.getState().revertStaging();
    expect(store.getState().document!.classes.some((item) => item.id === classId)).toBe(false);
    expect(store.getState().document!.instances.some((item) => item.id === "instance-empty")).toBe(
      true,
    );
  });

  it("preserves edit/focus across view changes and exits editing on submit", async () => {
    const { store } = await setup();
    store.getState().setFocus({ type: "instance", id: "instance-1" });
    store.getState().setEditing(true);
    store.getState().setViewMode("original");
    store.getState().setCurrentFrame("frame-1");
    expect(store.getState().editing).toBe(true);
    expect(store.getState().focus).toEqual({ type: "instance", id: "instance-1" });
    store.getState().addPolygon("instance-1", triangle);
    store.getState().submit();
    expect(store.getState().editing).toBe(false);
    await store.getState().waitForSubmissions();
  });

  it("serializes submissions while edits continue and advances its own CAS baseline", async () => {
    const { service, store } = await setup();
    const gate = deferred();
    const submit = service.submit.bind(service);
    let active = 0;
    let maximumActive = 0;
    service.submit = async (request) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await gate.promise;
      const result = await submit(request);
      active--;
      return result;
    };
    const firstId = store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("First");
    const secondId = store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("Second");
    const thirdId = store.getState().addPolygon("instance-2", triangle);
    expect(store.getState().stagedOperations).toHaveLength(1);
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "preparing",
      "preparing",
    ]);
    gate.resolve();
    await store.getState().waitForSubmissions();
    expect(maximumActive).toBe(1);
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(
      store.getState().document!.annotations[key]!.polygons.map((polygon) => polygon.id),
    ).toEqual(expect.arrayContaining([firstId, secondId]));
    expect(
      Object.values(store.getState().document!.annotations).some((annotation) =>
        annotation.polygons.some((polygon) => polygon.id === thirdId),
      ),
    ).toBe(true);
  });

  it("discards only a conflicting batch and retains later staged edits", async () => {
    const { service, store } = await setup();
    const gate = deferred();
    const submit = service.submit.bind(service);
    service.submit = async (request) => {
      await gate.promise;
      return await submit(request);
    };
    const rejectedId = store.getState().addPolygon("instance-1", triangle);
    service.setControls({ conflictNext: true });
    store.getState().submit("Conflict");
    const retainedId = store.getState().addPolygon("instance-2", triangle);
    gate.resolve();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("conflict");
    expect(store.getState().submissionQueue[0]!.conflicts).toEqual([key]);
    expect(
      store
        .getState()
        .document!.annotations[key]!.polygons.some((polygon) => polygon.id === rejectedId),
    ).toBe(false);
    expect(store.getState().stagedOperations).toHaveLength(1);
    expect(
      store
        .getState()
        .document!.annotations[
          frameInstanceKey("frame-0", "instance-2")
        ]!.polygons.some((polygon) => polygon.id === retainedId),
    ).toBe(true);
    store.getState().submit("Retained");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[1]!.status).toBe("succeeded");
  });

  it("keeps rejected multi-scope batches immutable after an unrelated scope succeeds", async () => {
    const { service, store } = await setup();
    const rejectedFirst = store.getState().addPolygon("instance-1", triangle);
    const rejectedSecond = store.getState().addPolygon("instance-2", triangle);
    service.setControls({ conflictNext: true });
    store.getState().submit("Rejected I and J");
    await store.getState().waitForSubmissions();
    const rejected = store.getState().submissionQueue[0]!;
    const audit = JSON.stringify(rejected);
    const secondKey = frameInstanceKey("frame-0", "instance-2");
    expect(rejected.status).toBe("conflict");
    expect(rejected.operations[1]?.expectedVersions[secondKey]).toBe(1);
    const retained = store.getState().addPolygon("instance-2", triangle);
    store.getState().submit("Independent J edit");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[1]?.status).toBe("succeeded");
    expect(store.getState().submissionQueue[0]).toBe(rejected);
    expect(JSON.stringify(store.getState().submissionQueue[0])).toBe(audit);
    expect(store.getState().document!.versions[secondKey]).toBe(2);
    const polygonIds = Object.values(store.getState().document!.annotations).flatMap((annotation) =>
      annotation.polygons.map((polygon) => polygon.id),
    );
    expect(polygonIds).toContain(retained);
    expect(polygonIds).not.toContain(rejectedFirst);
    expect(polygonIds).not.toContain(rejectedSecond);
    expect(store.getState().stagedOperations).toHaveLength(0);
  });

  it("retains a failed transport snapshot for explicit retry", async () => {
    const { service, store } = await setup();
    const id = store.getState().addPolygon("instance-1", triangle);
    service.setControls({ failNext: true });
    const batchId = store.getState().submit()!;
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("failed");
    expect(
      store.getState().document!.annotations[key]!.polygons.some((polygon) => polygon.id === id),
    ).toBe(true);
    store.getState().retrySubmission(batchId);
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
  });

  it("retries a lost acknowledgement without rolling back a later unrelated commit", async () => {
    const { service, store } = await setup();
    const submit = service.submit.bind(service);
    let loseAcknowledgement = true;
    service.submit = async (request) => {
      const result = await submit(request);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("Lost acknowledgement");
      }
      return result;
    };
    const firstPolygonId = store.getState().addPolygon("instance-1", triangle);
    const firstBatchId = store.getState().submit()!;
    await store.getState().waitForSubmissions();
    const secondPolygonId = store.getState().addPolygon("instance-2", triangle);
    store.getState().submit();
    await store.getState().waitForSubmissions();
    store.getState().retrySubmission(firstBatchId);
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(
      store
        .getState()
        .document!.annotations[key]!.polygons.some((polygon) => polygon.id === firstPolygonId),
    ).toBe(true);
    expect(
      store
        .getState()
        .document!.annotations[
          frameInstanceKey("frame-0", "instance-2")
        ]!.polygons.some((polygon) => polygon.id === secondPolygonId),
    ).toBe(true);
  });

  it("does not resurrect rejected polygons when later edits affect the same frame-instance", async () => {
    const { service, store } = await setup();
    const gate = deferred();
    const submit = service.submit.bind(service);
    service.submit = async (request) => {
      await gate.promise;
      return await submit(request);
    };
    const rejectedId = store.getState().addPolygon("instance-1", triangle);
    service.setControls({ conflictNext: true });
    store.getState().submit("Rejected");
    const retainedId = store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("Survives");
    gate.resolve();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "conflict",
      "succeeded",
    ]);
    const ids = store.getState().document!.annotations[key]!.polygons.map((polygon) => polygon.id);
    expect(ids).not.toContain(rejectedId);
    expect(ids).toContain(retainedId);
  });

  it("does not silently advance a staged CAS expectation after a background read", async () => {
    const { service, store } = await setup();
    store.getState().addPolygon("instance-1", triangle);
    service.simulateExternalEdit("frame-0", "instance-1");
    await store.getState().loadFrameWindow("video-1", 0, 10);
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("conflict");
  });

  it("detects an external conflict in an unloaded frame during a global merge", async () => {
    const { service, store } = await setup();
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-119", "instance-1")],
    ).toBeUndefined();
    service.simulateExternalEdit("frame-119", "instance-1");
    store.getState().mergeInstances(["instance-1"], "instance-2");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("conflict");
    expect(store.getState().submissionQueue[0]!.conflicts).toContain(
      frameInstanceKey("frame-119", "instance-1"),
    );
    expect(
      store.getState().document!.instances.some((instance) => instance.id === "instance-1"),
    ).toBe(true);
  });

  it("merges and deletes instances across unloaded frames without losing polygon IDs", async () => {
    const { service, store } = await setup();
    store.getState().mergeInstances(["instance-1"], "instance-2");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    const frameWindow = await service.loadFrameWindow("video-1", 23, 24);
    expect(frameWindow.annotations[frameInstanceKey("frame-119", "instance-1")]).toBeUndefined();
    expect(
      frameWindow.annotations[frameInstanceKey("frame-119", "instance-2")]!.polygons.map(
        (polygon) => polygon.id,
      ),
    ).toEqual(["instance-2-polygon-119", "instance-1-polygon-119"]);
    store.getState().deleteInstance("instance-2");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(
      Object.keys((await service.loadFrameWindow("video-1", 23, 24)).annotations),
    ).toHaveLength(0);
  });

  it("CAS-checks the destination when a new instance is created and merged in the same batch", async () => {
    const { service, store } = await setup();
    const sourceId = store.getState().addInstance("class-1");
    store.getState().addPolygon(sourceId, triangle);
    store.getState().mergeInstances([sourceId], "instance-2");
    service.simulateExternalEdit("frame-0", "instance-2");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("conflict");
    expect(store.getState().submissionQueue[0]!.conflicts).toContain(
      frameInstanceKey("frame-0", "instance-2"),
    );
    expect(store.getState().document!.instances.some((instance) => instance.id === sourceId)).toBe(
      false,
    );
  });

  it("browses read-only history without losing drafts, then rolls back as a new revision", async () => {
    const { store } = await setup();
    store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("Saved");
    await store.getState().waitForSubmissions();
    const classId = store.getState().addClass("Draft");
    await store.getState().viewRevision("revision-0");
    expect(store.getState().readonly).toBe(true);
    expect(() => store.getState().addClass("Blocked")).toThrow("read-only");
    expect(store.getState().document!.classes.some((item) => item.id === classId)).toBe(false);
    await store.getState().viewRevision();
    expect(store.getState().document!.classes.some((item) => item.id === classId)).toBe(true);
    store.getState().revertStaging();
    await store.getState().rollbackRevision("revision-0");
    expect(store.getState().revisions[0]!.message).toBe("Rollback to revision-0");
    expect(store.getState().document!.annotations[key]!.polygons).toHaveLength(1);
    expect(store.getState().document!.versions[key]).toBeGreaterThan(1);
  });

  it("loads only bounded windows, ignores stale responses, and exposes unloaded presence summaries", async () => {
    const { service, store } = await setup();
    expect(
      store.getState().document!.annotationSummaries[frameInstanceKey("frame-119", "instance-1")]!
        .pointCount,
    ).toBe(4);
    await expect(store.getState().loadFrameWindow("video-1", 0, 11)).rejects.toThrow("10 seconds");
    const load = service.loadFrameWindow.bind(service);
    const gate = deferred();
    service.loadFrameWindow = async (...args) => {
      if (args[1] === 10) {
        await gate.promise;
      }
      // Deliberately ignore cancellation to prove the store also guards stale completions.
      return await load(args[0], args[1], args[2]);
    };
    const stale = store.getState().loadFrameWindow("video-1", 10, 20);
    await store.getState().loadFrameWindow("video-1", 20, 24);
    gate.resolve();
    await stale;
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-80", "instance-1")],
    ).toBeUndefined();
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-119", "instance-1")],
    ).toBeDefined();
  });

  it("clamps automatically loaded geometry windows to the video duration", async () => {
    const { service, store } = await setup();
    const load = jest.spyOn(service, "loadFrameWindow");
    store.getState().setCurrentFrame("frame-119");
    expect(load).toHaveBeenLastCalledWith("video-1", 20, 24, expect.any(AbortSignal));
    store.getState().dispose();
  });

  it("locks editing during propagation and ignores late streamed frames after stop", async () => {
    const { service, store } = await setup();
    const gate = deferred();
    const firstConsumed = deferred();
    const source = store.getState().document!.annotations[key]!;
    service.propagate = async function* (request) {
      yield { ...source, frameId: "frame-1", context: request.context };
      firstConsumed.resolve();
      await gate.promise;
      yield { ...source, frameId: "frame-2", context: request.context };
    };
    const running = store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      frameCount: 2,
    });
    await firstConsumed.promise;
    expect(() => store.getState().addClass("Locked")).toThrow("Stop propagation");
    expect(() => {
      store.getState().setCurrentFrame("frame-5");
    }).toThrow("Stop propagation");
    store.getState().stopPropagation();
    await new Promise<void>((resolve) => {
      const detach = store.subscribe((state) => {
        if (state.propagation.status === "cancelled") {
          detach();
          resolve();
        }
      });
    });
    const classId = store.getState().addClass("After cancel");
    gate.resolve();
    await running;
    expect(store.getState().propagation.status).toBe("cancelled");
    expect(store.getState().propagation.processedFrames).toBe(1);
    expect(store.getState().stagedOperations).toHaveLength(2);
    expect(store.getState().document!.classes.some((item) => item.id === classId)).toBe(true);
  });

  it("streams later frames from the current unsubmitted seed", async () => {
    const { store } = await setup();
    const polygonId = store.getState().document!.annotations[key]!.polygons[0]!.id;
    store.getState().setPolygonPoints(polygonId, triangle);
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      frameCount: 2,
    });
    expect(store.getState().currentFrameId).toBe("frame-2");
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-2", "instance-1")]!
        .polygons[0]!.points,
    ).toEqual(shifted(triangle, 2));
  });

  it("prevents late initialization from changing a disposed store", async () => {
    const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
    const store = createSemanticSegmentationStore(service);
    const initializing = store.getState().initialize();
    store.getState().dispose();
    await initializing;
    expect(store.getState().document).toBeUndefined();
  });

  it("retains source classes when moving their children to another class", async () => {
    const { store } = await setup();
    store.getState().mergeClasses(["class-1"], "class-2");
    expect(store.getState().document!.classes.some((item) => item.id === "class-1")).toBe(true);
    expect(
      store.getState().document!.instances.filter((item) => item.classId === "class-1"),
    ).toHaveLength(0);
    store.getState().undo();
    expect(
      store.getState().document!.instances.filter((item) => item.classId === "class-1"),
    ).toHaveLength(3);
  });

  it("keeps moment references stable through rename and class movement", async () => {
    const { store } = await setup();
    const id = store.getState().addMomentReference("moment-1", "instance", "instance-1");
    store.getState().renameInstance("instance-1", "Renamed");
    store.getState().moveInstance("instance-1", "class-2");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().document!.momentReferences).toEqual([
      {
        id,
        momentId: "moment-1",
        targetType: "instance",
        targetId: "instance-1",
        recordId: "record-1",
        videoId: "video-1",
      },
    ]);
  });
});

describe("selection validity after document changes", () => {
  it.each(["undo", "revert", "conflict"] as const)(
    "prunes removed polygon refs after %s while keeping valid classes",
    async (change) => {
      const { store, service } = await setup();
      const id = store.getState().addPolygon("instance-empty");
      store.getState().setSelection([
        { type: "class", id: "class-1" },
        { type: "polygon", id },
        { type: "instance", id: "missing" },
      ]);
      if (change === "undo") {
        store.getState().undo();
      } else if (change === "revert") {
        store.getState().revertStaging();
      } else {
        service.setControls({ conflictNext: true });
        store.getState().submit();
        await store.getState().waitForSubmissions();
      }
      expect(store.getState().selection).toEqual([{ type: "class", id: "class-1" }]);
      expect(
        Object.values(store.getState().document!.annotations)
          .flatMap((item) => item.polygons)
          .some((polygon) => polygon.id === id),
      ).toBe(false);
    },
  );
});

describe("compound editor commands", () => {
  it("undoes every mutation part of one command while preserving prior staged work", async () => {
    const { store } = await setup();
    store.getState().renameClass("class-1", "Operator");
    const before = store.getState().document;
    store.getState().runTransaction("Move class contents", () => {
      store.getState().moveInstance("instance-1", "class-2");
      store.getState().moveInstance("instance-empty", "class-2");
    });
    const operations = store.getState().stagedOperations;
    expect(operations).toHaveLength(3);
    expect(operations[1]!.groupId).toBeDefined();
    expect(operations[1]!.groupId).toBe(operations[2]!.groupId);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
    expect(store.getState().stagedOperations).toHaveLength(1);
  });

  it("restores document, staging and focus if any command part throws", async () => {
    const { store } = await setup();
    store.getState().setFocus({ type: "instance", id: "instance-1" });
    store.getState().setEditing(true);
    const before = store.getState();
    expect(() => {
      store.getState().runTransaction("Invalid move", () => {
        store.getState().addInstance("class-2");
        store.getState().moveInstance("instance-1", "missing-class");
      });
    }).toThrow("Unknown");
    expect(store.getState().document).toEqual(before.document);
    expect(store.getState().stagedOperations).toEqual(before.stagedOperations);
    expect(store.getState().focus).toEqual(before.focus);
    expect(store.getState().editing).toBe(true);
  });

  it("retains independent CAS deltas when a grouped command is submitted", async () => {
    const { store, service } = await setup();
    store.getState().runTransaction("Create moved polygon", () => {
      const id = store.getState().addInstance("class-2", "Moved");
      store.getState().mergePolygons(["instance-1-polygon-0"], id);
    });
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
    const saved = await service.loadDocument();
    const moved = saved.instances.find((instance) => instance.name === "Moved")!;
    const frameWindow = await service.loadFrameWindow("video-1", 0, 1);
    expect(frameWindow.annotations[frameInstanceKey("frame-0", moved.id)]?.polygons[0]?.id).toBe(
      "instance-1-polygon-0",
    );
  });
});

describe("local segmentation service", () => {
  it("persists committed snapshots across adapter recreation and resets deterministically", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (id: string) => values.get(id) ?? "",
      setItem: (id: string, value: string) => {
        values.set(id, value);
      },
      removeItem: (id: string) => {
        values.delete(id);
      },
    };
    const first = createMockSemanticSegmentationService({ storage, controls: { delayMs: 0 } });
    const store = createSemanticSegmentationStore(first);
    await store.getState().initialize();
    store.getState().renameClass("class-1", "Saved name");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    const second = createMockSemanticSegmentationService({ storage, controls: { delayMs: 0 } });
    expect((await second.loadDocument()).classes[0]!.name).toBe("Saved name");
    expect(await second.listRevisions()).toHaveLength(2);
    const third = createMockSemanticSegmentationService({ storage, controls: { delayMs: 0 } });
    expect((await third.loadDocument()).classes[0]!.name).toBe("Saved name");
    second.reset();
    expect((await second.loadDocument()).classes[0]!.name).toBe("Person");
    expect(values.size).toBe(0);
  });

  it("keeps an in-memory commit successful and reports actionable storage exhaustion", async () => {
    const storage = {
      getItem: () => "",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const service = createMockSemanticSegmentationService({ storage, controls: { delayMs: 0 } });
    const store = createSemanticSegmentationStore(service);
    await store.getState().initialize();
    store.getState().renameClass("class-1", "In-memory name");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
    expect(store.getState().error).toMatch(/Export annotations/);
    expect((await service.loadDocument()).classes[0]!.name).toBe("In-memory name");
  });
});
