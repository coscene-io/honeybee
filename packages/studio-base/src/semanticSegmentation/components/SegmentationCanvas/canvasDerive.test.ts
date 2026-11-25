// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { activePolygonOf, deriveCanvas } from "./canvasDerive";
import type { CanvasDeriveInput } from "./canvasDerive";
import type { CanvasState } from "./canvasState";
import { frameInstanceKey } from "../../service";
import { createSeedDocument } from "../../testing/mockService";
import type { SegmentationDocument } from "../../types";

const document: SegmentationDocument = createSeedDocument();
const frame = document.frames[0]!;
const polygonId = (instanceId: string) =>
  (document.annotations[frameInstanceKey(frame.id, instanceId)] as { polygons: { id: string }[] })
    .polygons[0]!.id;

function input(overrides: Partial<CanvasState> = {}, rest: Partial<CanvasDeriveInput> = {}) {
  const state = {
    document,
    currentFrameId: frame.id,
    drawing: undefined,
    editing: false,
    focus: undefined,
    selection: [],
    creationTool: "polygon",
    propagationStatus: "idle",
    viewMode: "all",
    ...overrides,
  } as unknown as CanvasState;
  return {
    state,
    shownFrameId: undefined,
    imageUrl: "blob:image",
    decodedFrame: { nativeView: {} } as CanvasDeriveInput["decodedFrame"],
    disabled: false,
    panTool: false,
    selectedVertices: [],
    strokeFrameId: undefined,
    ...rest,
  } satisfies CanvasDeriveInput;
}

describe("deriveCanvas", () => {
  it("follows the store's frame unless the canvas shows its own", () => {
    expect(deriveCanvas(input()).frameId).toBe(frame.id);
    const other = document.frames[1]!;
    const derived = deriveCanvas(input({}, { shownFrameId: other.id }));
    expect(derived.frameId).toBe(other.id);
    expect(derived.frame).toBe(other);
    expect(derived.activeFrameId).toBe(frame.id);
  });

  it("locks editing but not navigation while the image is not mapped yet", () => {
    const derived = deriveCanvas(input({}, { decodedFrame: undefined }));
    expect(derived.locked).toBe(true);
    expect(derived.navigationLocked).toBe(false);
    expect(derived.nativeView).toBeUndefined();
  });

  it("locks both while propagating or disabled", () => {
    const propagating = deriveCanvas(input({ propagationStatus: "running" }));
    expect(propagating.locked).toBe(true);
    expect(propagating.navigationLocked).toBe(true);
    expect(deriveCanvas(input({}, { disabled: true })).navigationLocked).toBe(true);
    expect(deriveCanvas(input()).locked).toBe(false);
  });

  it("holds editing back on a canvas whose camera is not the one being drawn on", () => {
    const derived = deriveCanvas(input({}, { shownFrameId: "side-0", strokeFrameId: frame.id }));
    expect(derived.draftElsewhere).toBe(true);
    expect(derived.locked).toBe(true);
  });

  it("resolves the focused instance from an instance or a polygon focus", () => {
    expect(
      deriveCanvas(input({ focus: { type: "instance", id: "instance-1" } })).focusedInstanceId,
    ).toBe("instance-1");
    expect(
      deriveCanvas(input({ focus: { type: "polygon", id: polygonId("instance-2") } }))
        .focusedInstanceId,
    ).toBe("instance-2");
    expect(deriveCanvas(input({ focus: { type: "class", id: "class-1" } })).focusedInstanceId).toBe(
      undefined,
    );
  });

  it("lists the scope's polygons and the vertices of the one being edited", () => {
    const id = polygonId("instance-1");
    const derived = deriveCanvas(
      input({ editing: true, focus: { type: "instance", id: "instance-1" } }),
    );
    expect(derived.scopePolygons).toEqual([id]);
    expect(derived.activePolygonId).toBe(id);
    expect(derived.vertices.map((v) => v.polygonId)).toEqual([id, id, id, id]);
    expect(derived.editsVertices("instance-1", id)).toBe(true);
    expect(derived.editsVertices("instance-2", polygonId("instance-2"))).toBe(false);
    expect(derived.brushActive).toBe(false);
  });

  it("offers no vertices while drawing or viewing the original", () => {
    const focus = { type: "instance", id: "instance-1" } as const;
    expect(deriveCanvas(input({ editing: true, focus, viewMode: "original" })).vertices).toEqual(
      [],
    );
    expect(deriveCanvas(input({ editing: false, focus })).vertices).toEqual([]);
  });

  it("keeps only the selected vertices that are still editable", () => {
    const id = polygonId("instance-1");
    const derived = deriveCanvas(
      input(
        { editing: true, focus: { type: "instance", id: "instance-1" } },
        {
          selectedVertices: [
            { polygonId: id, vertex: 1 },
            { polygonId: id, vertex: 9 },
            { polygonId: "gone", vertex: 0 },
          ],
        },
      ),
    );
    expect(derived.selectedEditable).toEqual([{ polygonId: id, vertex: 1 }]);
    expect(derived.activePoint).toBeUndefined();
  });

  it("is in quick mode only while drawing with the quick tool", () => {
    const drawing = { instanceId: "instance-1" } as unknown as CanvasState["drawing"];
    expect(deriveCanvas(input({ drawing, creationTool: "quick" })).quickMode).toBe(true);
    expect(deriveCanvas(input({ drawing, creationTool: "polygon" })).quickMode).toBe(false);
    expect(deriveCanvas(input({ creationTool: "quick" })).quickMode).toBe(false);
  });
});

describe("activePolygonOf", () => {
  it("prefers the focused polygon, then a single selected one, then the only one in scope", () => {
    expect(activePolygonOf({ type: "polygon", id: "a" }, [], ["a", "b"])).toBe("a");
    expect(activePolygonOf(undefined, [{ type: "polygon", id: "b" }], ["a", "b"])).toBe("b");
    expect(activePolygonOf(undefined, [], ["a"])).toBe("a");
    expect(activePolygonOf(undefined, [], ["a", "b"])).toBeUndefined();
    expect(
      activePolygonOf(
        undefined,
        [
          { type: "polygon", id: "a" },
          { type: "polygon", id: "b" },
        ],
        ["a", "b"],
      ),
    ).toBeUndefined();
    expect(activePolygonOf({ type: "polygon", id: "z" }, [], ["a"])).toBe("a");
  });
});
