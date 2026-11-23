// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { AffineMatrix } from "../editorGeometry";
import {
  brushAfterKey,
  clampDelta,
  cursorFor,
  dragTargets,
  findHitTarget,
  fitToBounds,
  groupSelected,
  insertPointAfter,
  moveVertices,
  nudgeOffset,
  panKeyDelta,
  planVertexRemoval,
  pointInPolygon,
  previewOf,
  selectionAfterRect,
  toggleVertex,
  toScreen,
  verticesInRect,
} from "./canvasMath";
import type { Drag, EditableVertex } from "./canvasTypes";

const identity: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const square = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];

describe("vertex moves", () => {
  it("moves the chosen vertices and keeps them inside the image", () => {
    expect(moveVertices(square, [1], 0.5, -0.5)[1]).toEqual({ x: 1, y: 0 });
    expect(moveVertices(square, [1], 0.1, 0.1)[0]).toEqual(square[0]);
  });

  it("shrinks a move so no grouped vertex leaves the image", () => {
    const group = { instanceId: "i", polygonId: "p", points: square, indices: [0, 1] };
    const { dx, dy } = clampDelta([group], 1, -1);
    expect(dx).toBeCloseTo(0.4);
    expect(dy).toBeCloseTo(-0.2);
    expect(clampDelta([], 0.3, 0.4)).toEqual({ dx: 0.3, dy: 0.4 });
  });

  it("nudges by source pixels", () => {
    expect(nudgeOffset("ArrowRight", 10, 1000, 500)).toEqual({ x: 0.01, y: 0 });
    expect(nudgeOffset("ArrowUp", 1, 1000, 500)).toEqual({ x: 0, y: -0.002 });
    expect(nudgeOffset("x", 1, 1000, 500)).toEqual({ x: 0, y: 0 });
  });
});

describe("geometry helpers", () => {
  it("tests points against a polygon", () => {
    expect(pointInPolygon(square, { x: 0.4, y: 0.4 })).toBe(true);
    expect(pointInPolygon(square, { x: 0.7, y: 0.4 })).toBe(false);
    expect(pointInPolygon([], { x: 0, y: 0 })).toBe(false);
  });

  it("maps normalized points through the screen matrix", () => {
    const matrix = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 };
    expect(toScreen(matrix, { x: 0.5, y: 0.5 }, 100, 100)).toEqual({ x: 110, y: 170 });
  });

  it("inserts a point after a vertex", () => {
    expect(insertPointAfter(square, 3, { x: 0.1, y: 0.4 })).toHaveLength(5);
    expect(insertPointAfter(square, 0, { x: 0.4, y: 0.2 })[1]).toEqual({ x: 0.4, y: 0.2 });
  });

  it("frames points in the viewport at 85% of its size", () => {
    const fit = fitToBounds(
      [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ],
      { x: 0, y: 0, width: 1000, height: 500 },
    );
    expect(fit.center).toEqual({ x: 150, y: 125 });
    expect(fit.ratio).toBeCloseTo(0.85 * 10);
    expect(fit.panX).toBe(350);
    expect(fit.panY).toBe(125);
  });

  it("pans by arrow keys", () => {
    expect(panKeyDelta("ArrowLeft", 20)).toEqual({ x: 20, y: 0 });
    expect(panKeyDelta("ArrowDown", 20)).toEqual({ x: 0, y: -20 });
    expect(panKeyDelta("a", 20)).toEqual({ x: 0, y: 0 });
  });
});

describe("brush keys", () => {
  const brush = { mode: "paint", radius: 12 } as const;

  it("switches mode with B and E", () => {
    expect(brushAfterKey(brush, "e")).toEqual({ mode: "erase", radius: 12 });
    expect(brushAfterKey({ mode: "erase", radius: 5 }, "B")).toEqual({ mode: "paint", radius: 5 });
  });

  it("grows and shrinks the radius within 1-200", () => {
    expect(brushAfterKey(brush, "]").radius).toBe(15);
    expect(brushAfterKey(brush, "[").radius).toBe(10);
    expect(brushAfterKey({ ...brush, radius: 1 }, "[").radius).toBe(1);
    expect(brushAfterKey({ ...brush, radius: 200 }, "]").radius).toBe(200);
  });
});

describe("vertex selection", () => {
  const vertices: EditableVertex[] = square.map((point, vertex) => ({
    instanceId: "i",
    polygonId: "p",
    vertex,
    point,
    points: square,
  }));

  it("toggles a vertex", () => {
    const ref = { polygonId: "p", vertex: 1 };
    expect(toggleVertex([], ref)).toEqual([ref]);
    expect(toggleVertex([ref], ref)).toEqual([]);
  });

  it("finds the vertices in a rectangle given in any corner order", () => {
    expect(verticesInRect(vertices, { x: 0.7, y: 0.3 }, { x: 0.1, y: 0.1 })).toEqual([
      { polygonId: "p", vertex: 0 },
      { polygonId: "p", vertex: 1 },
    ]);
  });

  it("replaces or extends the selection after a rectangle select", () => {
    const current = [{ polygonId: "p", vertex: 0 }];
    const hits = [
      { polygonId: "p", vertex: 0 },
      { polygonId: "p", vertex: 2 },
    ];
    expect(selectionAfterRect(current, hits, { additive: false })).toEqual(hits);
    expect(selectionAfterRect(current, hits, { additive: true })).toEqual([
      { polygonId: "p", vertex: 0 },
      { polygonId: "p", vertex: 2 },
    ]);
  });

  it("groups selected vertices per polygon", () => {
    const groups = groupSelected(
      [
        { polygonId: "p", vertex: 0 },
        { polygonId: "p", vertex: 3 },
        { polygonId: "gone", vertex: 0 },
      ],
      vertices,
    );
    expect(groups).toEqual([{ instanceId: "i", polygonId: "p", points: square, indices: [0, 3] }]);
  });
});

describe("drag previews", () => {
  const polygonDrag = (vertex?: number): Extract<Drag, { type: "polygon" }> => ({
    type: "polygon",
    instanceId: "i",
    polygonId: "p",
    origin: { x: 0.4, y: 0.4 },
    screenOrigin: { x: 0, y: 0 },
    points: square,
    vertex,
  });

  it("moves one vertex to the pointer, clamped to the image", () => {
    const moved = previewOf(polygonDrag(2), { x: 1.5, y: 0.5 });
    expect(moved.p![2]).toEqual({ x: 1, y: 0.5 });
    expect(moved.p![0]).toEqual(square[0]);
  });

  it("translates a whole polygon without squashing it at the edge", () => {
    const moved = previewOf(polygonDrag(), { x: 0.5, y: 0.4 });
    expect(moved.p![0]!.x).toBeCloseTo(0.3);
    expect(moved.p![1]!.x).toBeCloseTo(0.7);
  });

  it("moves several selected vertices by the same delta", () => {
    const drag: Extract<Drag, { type: "vertices" }> = {
      type: "vertices",
      origin: { x: 0.2, y: 0.2 },
      screenOrigin: { x: 0, y: 0 },
      pressed: { polygonId: "p", vertex: 0 },
      targets: [{ instanceId: "i", polygonId: "p", points: square, indices: [0, 1] }],
    };
    const moved = previewOf(drag, { x: 0.3, y: 0.2 });
    expect(moved.p![0]!.x).toBeCloseTo(0.3);
    expect(moved.p![1]!.x).toBeCloseTo(0.7);
    expect(moved.p![2]).toEqual(square[2]);
    expect(dragTargets(drag)).toBe(drag.targets);
    expect(dragTargets(polygonDrag())[0]!.indices).toEqual([]);
  });
});

describe("hit testing", () => {
  const candidates = [{ instanceId: "i", polygonId: "p", points: square }];

  it("prefers a vertex within 8 screen pixels", () => {
    const hit = findHitTarget(candidates, identity, { x: 605, y: 200 }, 1000, 1000);
    expect(hit).toMatchObject({ type: "vertex", vertex: 1, polygonId: "p" });
  });

  it("finds an edge away from the vertices", () => {
    const edge = findHitTarget(candidates, identity, { x: 400, y: 203 }, 1000, 1000);
    expect(edge).toMatchObject({ type: "edge", after: 0, polygonId: "p" });
    expect(findHitTarget(candidates, identity, { x: 400, y: 212 }, 1000, 1000)).toBeUndefined();
  });

  it("hits nothing far from the polygon", () => {
    expect(findHitTarget(candidates, identity, { x: 900, y: 900 }, 1000, 1000)).toBeUndefined();
  });
});

describe("vertex removal", () => {
  it("keeps the other vertices and remembers the first removed", () => {
    const plan = planVertexRemoval([{ polygonId: "p", vertex: 2 }], () => square);
    expect(plan).toEqual([{ polygonId: "p", kept: [square[0], square[1], square[3]], first: 2 }]);
  });

  it("refuses to leave a polygon with fewer than 3 vertices", () => {
    expect(
      planVertexRemoval(
        [
          { polygonId: "p", vertex: 0 },
          { polygonId: "p", vertex: 1 },
        ],
        () => square,
      ),
    ).toBe("tooFew");
  });

  it("skips polygons it knows nothing about", () => {
    expect(planVertexRemoval([{ polygonId: "gone", vertex: 0 }], () => undefined)).toEqual([]);
  });
});

describe("cursor", () => {
  const idle = {
    panning: false,
    panTool: false,
    spaceHeld: false,
    drawing: false,
    brushActive: false,
    hover: undefined,
  };

  it("follows the mode in priority order", () => {
    expect(cursorFor({ ...idle, panning: true, drawing: true })).toBe("grabbing");
    expect(cursorFor({ ...idle, spaceHeld: true, drawing: true })).toBe("grab");
    expect(cursorFor({ ...idle, panTool: true })).toBe("grab");
    expect(cursorFor({ ...idle, drawing: true, brushActive: true })).toBe("crosshair");
    expect(cursorFor({ ...idle, brushActive: true })).toBe("none");
    expect(
      cursorFor({
        ...idle,
        hover: {
          type: "edge",
          instanceId: "i",
          polygonId: "p",
          points: square,
          after: 0,
          point: square[0]!,
        },
      }),
    ).toBe("copy");
    expect(cursorFor(idle)).toBe("default");
  });
});
