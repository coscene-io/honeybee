/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";
import { deserialize, serialize } from "v8";

import { AnnotationSession } from "./AnnotationSession";
import { MockAnnotationService } from "./MockAnnotationService";
import { PolygonCanvas } from "./PolygonCanvas";

// jsdom lacks these browser APIs; Node's serializer provides a detached fixture clone.
Object.defineProperty(globalThis, "structuredClone", {
  configurable: true,
  value: (value: unknown) => deserialize(serialize(value)) as unknown,
});
Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent });

it("draws floats in image coordinates, completes only valid polygons, and aborts writes during a seek", async () => {
  const session = new AnnotationSession(new MockAnnotationService(0), "canvas-test");
  await session.load();
  session.edit((document) => {
    document.classes.push({ id: "class", name: "Vehicle", color: "#50c7f2" });
    document.instances.push({ id: "instance", classId: "class", name: "Car 1" });
  });
  const viewport = {
    topic: "/camera",
    displayedTimeNs: 200_000_000n,
    imageWidth: 1280,
    imageHeight: 720,
    project: (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 2 }),
    unproject: (point: { x: number; y: number }) => ({ x: point.x / 2, y: point.y / 2 }),
  };
  let current = true;
  const props = {
    session,
    document: session.getSnapshot().document,
    viewport,
    frame: 2,
    instanceId: "instance",
    selectedPolygonId: undefined,
    onSelect: jest.fn(),
    tool: "draw" as const,
    focus: "all" as const,
    disabled: false,
    canEdit: () => current,
    onWheel: jest.fn(),
  };
  const { rerender } = render(<PolygonCanvas {...props} />);
  const canvas = screen.getByRole("application");
  fireEvent.pointerDown(canvas, { button: 0, clientX: 10.5, clientY: 20.5 });
  fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 20 });
  fireEvent.keyDown(canvas, { key: "Enter" });
  expect(session.getSnapshot().document.frames["2"]).toBeUndefined();
  fireEvent.pointerDown(canvas, { button: 0, clientX: 80, clientY: 100 });
  current = false;
  fireEvent.keyDown(canvas, { key: "Enter" });
  expect(session.getSnapshot().document.frames["2"]).toBeUndefined();
  current = true;
  fireEvent.keyDown(canvas, { key: "Enter" });
  const polygon = session.getSnapshot().document.frames["2"]![0]!;
  expect(polygon.points[0]).toEqual({ x: 5.25, y: 10.25 });
  expect(polygon.points).toHaveLength(3);

  rerender(
    <PolygonCanvas
      {...props}
      document={session.getSnapshot().document}
      tool="select"
      selectedPolygonId={polygon.id}
    />,
  );
  Object.assign(canvas, { setPointerCapture: jest.fn(), hasPointerCapture: () => false });
  const handle = canvas.querySelector("circle")!;
  fireEvent.pointerDown(handle, { button: 0, clientX: 10.5, clientY: 20.5 });
  fireEvent.pointerMove(canvas, { clientX: 40, clientY: 60 });
  fireEvent.pointerMove(canvas, { clientX: 50, clientY: 70 });
  fireEvent.pointerUp(canvas);
  expect(session.getSnapshot().document.frames["2"]![0]!.points[0]).toEqual({ x: 25, y: 35 });
  session.undo();
  expect(session.getSnapshot().document.frames["2"]![0]!.points[0]).toEqual({ x: 5.25, y: 10.25 });
});
