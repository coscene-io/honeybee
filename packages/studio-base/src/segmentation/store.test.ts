// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { lineColors } from "@foxglove/studio-base/util/plotColors";

import { countsFromRuns, encodeCounts, runsFromIntervals } from "./maskCodec";
import {
  maskArea,
  maskOf,
  polygonsOf,
  runsOfPolygons,
  summarizeObservation,
  summaryHasGeometry,
} from "./maskGeometry";
import { applySegmentationPatch, frameInstanceKey } from "./service";
import { createSegmentationStore } from "./store";
import { createMockSegmentationService, createSeedDocument } from "./testing/mockService";
import { type FrameInstance, NormalizedPoint } from "./types";

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
  const service = createMockSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

describe("loaded frame geometry", () => {
  async function limited(maxLoadedFrames: number) {
    const service = createMockSegmentationService({
      controls: { delayMs: 0, streamDelayMs: 0 },
    });
    const store = createSegmentationStore(service, { maxLoadedFrames });
    await store.getState().initialize();
    return store;
  }
  const geometryOf = (store: Awaited<ReturnType<typeof limited>>, frameId: string) =>
    Object.values(store.getState().document!.annotations).filter((item) => item.frameId === frameId)
      .length;

  it("drops the geometry of frames far from the current one once the limit is exceeded", async () => {
    const store = await limited(30);
    expect(geometryOf(store, "frame-0")).toBeGreaterThan(0);
    store.getState().setCurrentFrame("frame-110");
    await store.getState().loadFrameWindow("video-1", 20, 24);
    expect(geometryOf(store, "frame-110")).toBeGreaterThan(0);
    expect(geometryOf(store, "frame-0")).toBe(0);
    expect(store.getState().isFrameReady("frame-0")).toBe(false);
    // Coming back reads it again.
    store.getState().setCurrentFrame("frame-0");
    await store.getState().loadFrameWindow("video-1", 0, 4);
    expect(geometryOf(store, "frame-0")).toBeGreaterThan(0);
  });

  it("keeps frames with unsaved edits and everything under the limit", async () => {
    const store = await limited(30);
    store.getState().addPolygon("instance-2", triangle);
    store.getState().setCurrentFrame("frame-110");
    await store.getState().loadFrameWindow("video-1", 20, 24);
    expect(geometryOf(store, "frame-0")).toBeGreaterThan(0);
    const roomy = await limited(1000);
    roomy.getState().setCurrentFrame("frame-110");
    await roomy.getState().loadFrameWindow("video-1", 20, 24);
    expect(geometryOf(roomy, "frame-0")).toBeGreaterThan(0);
  });
});

describe("segmentation state", () => {
  it("creates stable empty tree nodes, preserves float coordinates and undoes local changes", async () => {
    const { store } = await setup();
    const classId = store.getState().addClass("  Tool  ");
    expect(store.getState().addClass("Tool")).toBe(classId);
    const instanceId = store.getState().addInstance(classId);
    const annotationKey = frameInstanceKey("frame-0", instanceId);
    // A drawing session stages nothing: the draft lives in the canvas until it is complete.
    const staged = store.getState().stagedOperations.length;
    store.getState().startDrawing(instanceId);
    expect(store.getState().drawing).toEqual({ instanceId, frameId: "frame-0" });
    expect(store.getState().stagedOperations).toHaveLength(staged);
    expect(store.getState().document!.annotations[annotationKey]).toBeUndefined();
    expect(() => store.getState().addPolygon(instanceId, triangle.slice(0, 2))).toThrow(
      "at least 3 vertices",
    );
    const polygonId = store.getState().addPolygon(instanceId, triangle);
    expect(store.getState().drawing).toBeUndefined();
    expect(store.getState().document!.annotations[annotationKey]).toEqual({
      frameId: "frame-0",
      instanceId,
      kind: "polygons",
      polygons: [{ id: polygonId, points: triangle, topic: "/camera/front" }],
    });
    const moved = triangle.map((point) => ({ x: point.x + 0.01, y: point.y }));
    store.getState().setPolygonPoints(polygonId, moved);
    expect(polygonsOf(store.getState().document!.annotations[annotationKey])[0]!.points).toEqual(
      moved,
    );
    expect(() => {
      store.getState().setPolygonPoints(polygonId, [{ x: NaN, y: 0 }]);
    }).toThrow("normalized");
    expect(() => {
      store.getState().setPolygonPoints(polygonId, moved.slice(0, 2));
    }).toThrow("at least 3 vertices");
    store.getState().undo();
    expect(polygonsOf(store.getState().document!.annotations[annotationKey])[0]!.points).toEqual(
      triangle,
    );
    // Deleting the last polygon clears the observation; it never stays as an empty placeholder.
    store.getState().deletePolygon(polygonId);
    expect(store.getState().document!.annotations[annotationKey]).toBeUndefined();
    store.getState().undo();
    expect(polygonsOf(store.getState().document!.annotations[annotationKey])[0]!.id).toBe(
      polygonId,
    );
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

  it("serializes submissions while edits continue", async () => {
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
      "queued",
      "queued",
    ]);
    gate.resolve();
    await store.getState().waitForSubmissions();
    expect(maximumActive).toBe(1);
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(
      polygonsOf(store.getState().document!.annotations[key]).map((polygon) => polygon.id),
    ).toEqual(expect.arrayContaining([firstId, secondId]));
    expect(
      Object.values(store.getState().document!.annotations).some((annotation) =>
        polygonsOf(annotation).some((polygon) => polygon.id === thirdId),
      ),
    ).toBe(true);
  });

  it("retains a failed transport snapshot for explicit retry", async () => {
    const { service, store } = await setup();
    const id = store.getState().addPolygon("instance-1", triangle);
    service.setControls({ failNext: true });
    const batchId = store.getState().submit()!;
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("failed");
    expect(
      polygonsOf(store.getState().document!.annotations[key]).some((polygon) => polygon.id === id),
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
    const document = store.getState().document!;
    expect(
      polygonsOf(document.annotations[key]).some((polygon) => polygon.id === firstPolygonId),
    ).toBe(true);
    expect(
      polygonsOf(document.annotations[frameInstanceKey("frame-0", "instance-2")]).some(
        (polygon) => polygon.id === secondPolygonId,
      ),
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
      polygonsOf(frameWindow.annotations[frameInstanceKey("frame-119", "instance-2")]).map(
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

  it("prefetches playback windows in the background without aborting the foreground load", async () => {
    const { service, store } = await setup();
    const load = service.loadFrameWindow.bind(service);
    const gate = deferred();
    const calls: number[] = [];
    service.loadFrameWindow = async (videoId, startSec, endSec, signal) => {
      calls.push(startSec);
      if (startSec === 10) {
        await gate.promise;
      }
      return await load(videoId, startSec, endSec, signal);
    };
    const foreground = store.getState().loadFrameWindow("video-1", 10, 20);
    // Two cameras asking for the same window share one read; neither shows loading or errors.
    await Promise.all([
      store.getState().prefetchFrameWindow("video-1", 20, 24),
      store.getState().prefetchFrameWindow("video-1", 20, 24),
    ]);
    expect(calls.filter((start) => start === 20)).toHaveLength(1);
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-119", "instance-1")],
    ).toBeDefined();
    expect(store.getState().loading).toBe(true);
    gate.resolve();
    await foreground;
    // The foreground window was not aborted by the background read.
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-80", "instance-1")],
    ).toBeDefined();
    expect(store.getState().loading).toBe(false);
    // A fully loaded window is never read again.
    await store.getState().prefetchFrameWindow("video-1", 20, 24);
    expect(calls.filter((start) => start === 20)).toHaveLength(1);
    await expect(store.getState().prefetchFrameWindow("video-1", 0, 11)).rejects.toThrow(
      "10 seconds",
    );
    store.getState().dispose();
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
      endTimeNs: "1700000000400000000",
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
    const polygonId = polygonsOf(store.getState().document!.annotations[key])[0]!.id;
    store.getState().setPolygonPoints(polygonId, triangle);
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      endTimeNs: "1700000000400000000",
    });
    expect(store.getState().currentFrameId).toBe("frame-2");
    expect(
      polygonsOf(
        store.getState().document!.annotations[frameInstanceKey("frame-2", "instance-1")],
      )[0]!.points,
    ).toEqual(shifted(triangle, 2));
  });

  it("keeps mock polygons inside the image without collapsing their shape", async () => {
    const { store } = await setup();
    const polygonId = polygonsOf(store.getState().document!.annotations[key])[0]!.id;
    const edge = [
      { x: 0.8, y: 0.8 },
      { x: 0.99, y: 0.8 },
      { x: 0.8, y: 0.99 },
    ];
    store.getState().setPolygonPoints(polygonId, edge);
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      endTimeNs: "1700000000400000000",
    });
    const points = polygonsOf(
      store.getState().document!.annotations[frameInstanceKey("frame-2", "instance-1")],
    )[0]!.points;
    expect(
      points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1),
    ).toBe(true);
    expect(points[1]!.x - points[0]!.x).toBeCloseTo(0.19);
    expect(points[2]!.y - points[0]!.y).toBeCloseTo(0.19);
    store.getState().dispose();
  });

  it("prevents late initialization from changing a disposed store", async () => {
    const service = createMockSegmentationService({ controls: { delayMs: 0 } });
    const store = createSegmentationStore(service);
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
});

describe("selection validity after document changes", () => {
  it.each(["undo", "revert"] as const)(
    "prunes removed polygon refs after %s while keeping valid classes",
    async (change) => {
      const { store } = await setup();
      const id = store.getState().addPolygon("instance-empty", triangle);
      store.getState().setSelection([
        { type: "class", id: "class-1" },
        { type: "polygon", id },
        { type: "instance", id: "missing" },
      ]);
      if (change === "undo") {
        store.getState().undo();
      } else {
        store.getState().revertStaging();
      }
      expect(store.getState().selection).toEqual([{ type: "class", id: "class-1" }]);
      expect(
        Object.values(store.getState().document!.annotations)
          .flatMap((item) => polygonsOf(item))
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
    store.getState().runTransaction("opLabelEditTree", () => {
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
      store.getState().runTransaction("opLabelEditTree", () => {
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
    store.getState().runTransaction("opLabelEditTree", () => {
      const id = store.getState().addInstance("class-2", "Moved");
      store.getState().mergePolygons(["instance-1-polygon-0"], id);
    });
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
    const saved = await service.loadDocument();
    const moved = saved.instances.find((instance) => instance.name === "Moved")!;
    const frameWindow = await service.loadFrameWindow("video-1", 0, 1);
    expect(polygonsOf(frameWindow.annotations[frameInstanceKey("frame-0", moved.id)])[0]?.id).toBe(
      "instance-1-polygon-0",
    );
  });
});

describe("one geometry per observation", () => {
  /** A filled rectangle at the mock front camera's 960×540 source size. */
  function rectangleMask(x0: number, y0: number, x1: number, y1: number) {
    const intervals: number[] = [];
    for (let x = x0; x < x1; x++) {
      intervals.push(x * 540 + y0, x * 540 + y1);
    }
    return {
      counts: countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), 960, 540)),
      width: 960,
      height: 540,
    };
  }

  it("unions a quick mask with polygons into one mask, and undo restores the polygons", async () => {
    const { store } = await setup();
    const before = store.getState().document!.annotations[key]!;
    expect(before.kind).toBe("polygons");
    store.getState().addMask("instance-1", rectangleMask(600, 100, 700, 200));
    const after = store.getState().document!.annotations[key]!;
    expect(after.kind).toBe("mask");
    expect(maskArea(maskOf(after)!.counts)).toBe(
      runsOfPolygons(polygonsOf(before), 960, 540).area + 100 * 100,
    );
    store.getState().undo();
    expect(store.getState().document!.annotations[key]).toEqual(before);
  });

  it("rasterizes a polygon drawn on a mask instead of mixing representations", async () => {
    const { store } = await setup();
    store.getState().addMask("instance-empty", rectangleMask(10, 10, 20, 20));
    const emptyKey = frameInstanceKey("frame-0", "instance-empty");
    store.getState().addPolygon("instance-empty", triangle);
    const merged = store.getState().document!.annotations[emptyKey]!;
    expect(merged.kind).toBe("mask");
    expect(maskArea(maskOf(merged)!.counts)).toBeGreaterThan(100);
  });

  it("rejects a mask bound to another frame size", async () => {
    const { store } = await setup();
    expect(() => {
      store.getState().addMask("instance-1", { ...rectangleMask(0, 0, 4, 4), width: 961 });
    }).toThrow("960×540");
  });

  it("converts explicitly between representations, each one undoable", async () => {
    const { store } = await setup();
    const polygons = store.getState().document!.annotations[key]!;
    store.getState().convertToMask("instance-1");
    const mask = store.getState().document!.annotations[key]!;
    expect(mask.kind).toBe("mask");
    store.getState().convertToPolygons("instance-1");
    const back = store.getState().document!.annotations[key]!;
    expect(back.kind).toBe("polygons");
    expect(polygonsOf(back).length).toBeGreaterThan(0);
    store.getState().undo();
    expect(store.getState().document!.annotations[key]).toEqual(mask);
    store.getState().undo();
    expect(store.getState().document!.annotations[key]).toEqual(polygons);
  });

  it("clears the observation when the eraser leaves no pixels", async () => {
    const { store } = await setup();
    store.getState().addMask("instance-empty", rectangleMask(10, 10, 20, 20));
    const emptyKey = frameInstanceKey("frame-0", "instance-empty");
    store.getState().replaceMask("instance-empty", rectangleMask(0, 0, 0, 0), "opLabelErase");
    expect(store.getState().document!.annotations[emptyKey]).toBeUndefined();
  });

  it("ends a drawing session when its instance goes away, and cancelling stages nothing", async () => {
    const { store } = await setup();
    const staged = store.getState().stagedOperations.length;
    store.getState().startDrawing("instance-empty", "quick");
    expect(store.getState().creationTool).toBe("quick");
    store.getState().cancelDrawing();
    expect(store.getState().drawing).toBeUndefined();
    expect(store.getState().stagedOperations).toHaveLength(staged);
    store.getState().setCreationTool("polygon");
    store.getState().startDrawing("instance-empty");
    store.getState().deleteInstance("instance-empty");
    expect(store.getState().drawing).toBeUndefined();
  });

  it("stages an empty propagation result as a cleared observation", async () => {
    const { service, store } = await setup();
    service.propagate = async function* (request) {
      yield {
        frameId: "frame-1",
        instanceId: "instance-1",
        kind: "empty" as const,
        ...(request.context ? { context: request.context } : {}),
      };
    };
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      endTimeNs: "1700000000200000000",
    });
    expect(store.getState().stagedOperations.at(-1)!.patch.annotations).toEqual({
      [frameInstanceKey("frame-1", "instance-1")]: undefined,
    });
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-1")],
    ).toBeUndefined();
  });
});

it("colours new classes from the app's categorical palette", async () => {
  const { store } = await setup();
  const existing = store.getState().document!.classes.length;
  const ids = [store.getState().addClass("First new"), store.getState().addClass("Second new")];
  const colors = ids.map(
    (id) => store.getState().document!.classes.find((item) => item.id === id)!.color,
  );
  expect(colors).toEqual([
    lineColors[existing % lineColors.length],
    lineColors[(existing + 1) % lineColors.length],
  ]);
  store.getState().dispose();
});

it("asks the service to cancel a running propagation when the store is disposed", async () => {
  const { service, store } = await setup();
  const started = deferred();
  // A run that streams nothing until it is aborted.
  service.propagate = async function* (_request, signal) {
    started.resolve();
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        resolve();
      });
    });
    yield* [];
  };
  const cancel = jest.spyOn(service, "cancelPropagation");
  const running = store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-0",
    endTimeNs: "1700000000400000000",
  });
  await started.promise;
  store.getState().dispose();
  await running;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]![0].instanceId).toBe("instance-1");
});

it("trims a supplied instance name and rejects one the editor would not accept", async () => {
  const service = createMockSegmentationService({ controls: { delayMs: 0, streamDelayMs: 0 } });
  const store = createSegmentationStore(service);
  await store.getState().initialize();
  expect(() => store.getState().addInstance("class-2", "   ")).toThrow();
  expect(() => store.getState().addInstance("class-2", "x".repeat(101))).toThrow();
  const id = store.getState().addInstance("class-2", "  Named  ");
  expect(store.getState().document!.instances.find((item) => item.id === id)?.name).toBe("Named");
  store.getState().dispose();
});

it.each(["mask", "polygons"] as const)(
  "keeps presence and waits for geometry before reporting the area of a mask merged with %s",
  (kind) => {
    const document = createSeedDocument();
    const frameId = "frame-5";
    const sourceKey = frameInstanceKey(frameId, "instance-1");
    const targetKey = frameInstanceKey(frameId, "instance-2");
    const source: FrameInstance =
      kind === "polygons"
        ? {
            frameId,
            instanceId: "instance-1",
            kind,
            polygons: [{ id: "polygon", points: triangle }],
          }
        : {
            frameId,
            instanceId: "instance-1",
            kind,
            mask: { counts: encodeCounts([0, 5, 95]), width: 10, height: 10 },
          };
    const target: FrameInstance = {
      frameId,
      instanceId: "instance-2",
      kind: "mask",
      mask: { counts: encodeCounts([3, 6, 91]), width: 10, height: 10 },
    };
    document.annotations = {};
    document.annotationSummaries = {
      [sourceKey]: summarizeObservation(source),
      [targetKey]: summarizeObservation(target),
    };
    const patch = { instanceMerges: { "instance-1": "instance-2" } };
    const staged = applySegmentationPatch(document, patch);
    expect(staged.annotationSummaries[sourceKey]).toBeUndefined();
    expect(staged.annotationSummaries[targetKey]).toEqual({
      polygonCount: 0,
      pointCount: 0,
      maskArea: "unknown",
    });
    expect(summaryHasGeometry(staged.annotationSummaries[targetKey])).toBe(true);

    document.annotations = { [sourceKey]: source, [targetKey]: target };
    const loaded = applySegmentationPatch(document, patch);
    expect(loaded.annotations[targetKey]?.kind).toBe("mask");
    expect(loaded.annotationSummaries[targetKey]?.maskArea).toBe(kind === "mask" ? 9 : 11);
  },
);
