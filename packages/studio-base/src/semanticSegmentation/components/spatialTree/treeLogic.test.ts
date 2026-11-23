// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  affectedInstancesOf,
  canMergeNodes,
  classOfNode,
  dialogNodesOf,
  dialogStillValid,
  dialogTitleKey,
  indentStyle,
  mergePlan,
  mergeTargetsOf,
  moveTargetsOf,
  nodeExists,
  pinnedRowsOf,
  presenceCellsOf,
  treeFrameIdsOf,
} from "./treeLogic";
import type { TreeDialog } from "./treeTypes";
import { createSeedDocument } from "../../testing/mockService";
import type { SegmentationDocument, SegmentationFrame } from "../../types";

const document: SegmentationDocument = {
  ...createSeedDocument(),
  annotationSummaries: {},
  record: { id: "r", name: "record" },
  videos: [],
  frames: [],
  classes: [
    { id: "a", name: "A", color: "red" },
    { id: "b", name: "B", color: "blue" },
  ],
  instances: [
    { id: "i", classId: "a", name: "I" },
    { id: "j", classId: "a", name: "J" },
    { id: "k", classId: "b", name: "K" },
  ],
  annotations: {
    f: { frameId: "f", instanceId: "i", kind: "polygons", polygons: [{ id: "p", points: [] }] },
  },
};

const frame = (id: string) => ({ id }) as SegmentationFrame;

describe("tree frame listing", () => {
  const frameById = new Map([frame("f1"), frame("f2")].map((item) => [item.id, item]));

  it("lists the surfaces' frames of an open session, deduplicated and known", () => {
    expect(
      treeFrameIdsOf({
        sessionOpen: true,
        surfaces: { p1: { frameId: "f1" }, p2: { frameId: "f1" }, p3: { frameId: "gone" }, p4: {} },
        previewFrames: {},
        frameById,
        currentFrameId: "f2",
      }),
    ).toEqual(["f1"]);
  });

  it("lists the preview frames while no session is open", () => {
    expect(
      treeFrameIdsOf({
        sessionOpen: false,
        surfaces: {},
        previewFrames: { camera: "f2", other: undefined },
        frameById,
        currentFrameId: "f1",
      }),
    ).toEqual(["f2"]);
  });

  it("lists nothing for a preview whose frames are unknown, else the current frame", () => {
    const base = { surfaces: {}, frameById, currentFrameId: "f1" };
    expect(
      treeFrameIdsOf({ ...base, sessionOpen: false, previewFrames: { camera: "gone" } }),
    ).toEqual([]);
    expect(treeFrameIdsOf({ ...base, sessionOpen: false, previewFrames: {} })).toEqual(["f1"]);
    expect(
      treeFrameIdsOf({
        ...base,
        sessionOpen: true,
        surfaces: {},
        previewFrames: {},
        currentFrameId: undefined,
      }),
    ).toEqual([]);
  });
});

describe("tree dialogs", () => {
  const merge: TreeDialog = { type: "merge", nodes: [{ type: "instance", id: "i" }] };

  it("names the nodes a dialog acts on", () => {
    expect(dialogNodesOf(undefined)).toEqual([]);
    expect(dialogNodesOf({ type: "delete-class", id: "a" })).toEqual([{ type: "class", id: "a" }]);
    expect(dialogNodesOf(merge)).toEqual([{ type: "instance", id: "i" }]);
    expect(dialogNodesOf({ type: "rename", node: { type: "class", id: "b" } })).toEqual([
      { type: "class", id: "b" },
    ]);
  });

  it("picks the dialog title", () => {
    expect(dialogTitleKey({ type: "rename", node: { type: "class", id: "a" } })).toBe(
      "renameClass",
    );
    expect(dialogTitleKey({ type: "rename", node: { type: "instance", id: "i" } })).toBe(
      "renameInstance",
    );
    expect(dialogTitleKey(merge)).toBe("mergeIntoInstanceTitle");
    expect(dialogTitleKey({ type: "move", node: { type: "instance", id: "i" } })).toBe(
      "moveClassTitle",
    );
    expect(dialogTitleKey({ type: "delete-class", id: "a" })).toBe("deleteClassAllInstances");
    expect(dialogTitleKey(undefined)).toBe("deleteSelectedAnnotations");
  });

  it("offers every other instance as a merge target, and other classes as move targets", () => {
    expect(mergeTargetsOf(document, merge, undefined, undefined).map((item) => item.id)).toEqual([
      "j",
      "k",
    ]);
    expect(mergeTargetsOf(document, undefined, undefined, undefined)).toEqual([]);
    expect(
      moveTargetsOf(document, { type: "instance", id: "i" }, undefined, undefined).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });

  it("rejects a dialog whose targets vanished", () => {
    const move: TreeDialog = { type: "move", node: { type: "instance", id: "i" } };
    expect(dialogStillValid(document, move, [{ type: "instance", id: "i" }], "b")).toBe(true);
    expect(dialogStillValid(document, move, [{ type: "instance", id: "i" }], "zzz")).toBe(false);
    expect(dialogStillValid(document, merge, [{ type: "instance", id: "gone" }], "j")).toBe(false);
    expect(dialogStillValid(document, merge, [{ type: "instance", id: "i" }], "gone")).toBe(false);
  });

  it("collects the instances a delete touches through polygons and classes", () => {
    const compact = { classes: ["b"], instances: [], polygons: ["p"] };
    expect(affectedInstancesOf(document, compact).sort()).toEqual(["i", "k"]);
  });
});

describe("node helpers", () => {
  it("tells whether a node still exists", () => {
    expect(nodeExists(document, { type: "class", id: "a" })).toBe(true);
    expect(nodeExists(document, { type: "class", id: "z" })).toBe(false);
    expect(nodeExists(document, { type: "instance", id: "k" })).toBe(true);
    expect(nodeExists(document, { type: "polygon", id: "p" })).toBe(true);
    expect(nodeExists(document, { type: "polygon", id: "q" })).toBe(false);
  });

  it("finds the class of a node", () => {
    expect(classOfNode(document, { type: "class", id: "b" })).toBe("b");
    expect(classOfNode(document, { type: "instance", id: "k" })).toBe("b");
  });

  it("requires service support to merge instances but not polygons", () => {
    const instance = [{ type: "instance", id: "i" } as const];
    const polygon = [{ type: "polygon", id: "p" } as const];
    expect(canMergeNodes(instance, { supportsInstanceMerge: false })).toBe(false);
    expect(canMergeNodes(instance, { supportsInstanceMerge: true })).toBe(true);
    expect(canMergeNodes(polygon, { supportsInstanceMerge: false })).toBe(true);
    expect(canMergeNodes([], { supportsInstanceMerge: true })).toBe(false);
  });

  it("plans a merge, leaving out the target itself", () => {
    expect(
      mergePlan(
        document,
        [
          { type: "class", id: "a" },
          { type: "polygon", id: "p" },
        ],
        "i",
      ),
    ).toEqual({ instances: ["j"], polygons: [] });
    expect(mergePlan(document, [{ type: "polygon", id: "p" }], "j")).toEqual({
      instances: [],
      polygons: ["p"],
    });
  });
});

describe("row layout", () => {
  it("indents nested rows and draws one guide per level above the first", () => {
    expect(indentStyle(1, "grey")).toBeUndefined();
    expect(indentStyle(3, "grey")).toEqual({
      paddingLeft: 50,
      backgroundRepeat: "no-repeat",
      backgroundSize: "1px 100%",
      backgroundPosition: "12px 0, 37px 0",
      backgroundImage: "linear-gradient(grey, grey), linear-gradient(grey, grey)",
    });
  });

  it("pins the class and instance that own the first visible row", () => {
    const rows = [
      { classRow: 0 },
      { classRow: 0, instanceRow: 1 },
      { classRow: 0, instanceRow: 1 },
      { classRow: 0, instanceRow: 1 },
    ];
    const offsets = Float64Array.from([0, 40, 80, 120, 160]);
    const base = { viewportHeight: 100, start: 0, offsets };
    expect(pinnedRowsOf(rows, { ...base, scrollTop: 0 })).toEqual([]);
    expect(pinnedRowsOf(rows, { ...base, scrollTop: 100 })).toEqual([0, 1]);
    expect(pinnedRowsOf(rows, { ...base, scrollTop: 100, viewportHeight: 0 })).toEqual([]);
    expect(pinnedRowsOf([], { ...base, scrollTop: 100 })).toEqual([]);
  });

  it("describes presence around the current frame", () => {
    const frames = new Map([
      [5, { id: "a" }],
      [6, { id: "b" }],
    ]);
    const cells = presenceCellsOf(
      6,
      (position) => frames.get(position),
      (id) => id === "b",
    );
    expect(cells).toHaveLength(41);
    expect(cells[20]).toBe("1");
    expect(cells[19]).toBe("0");
    expect(cells[21]).toBe(".");
  });
});
