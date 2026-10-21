// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useRef, useState } from "react";

import { AnnotationSession } from "./AnnotationSession";
import { AnnotationDocument, Point, Polygon } from "./model";
import { ImageAnnotationViewport } from "./viewport";

export type CanvasTool = "select" | "draw" | "pan";

type Props = {
  session: AnnotationSession;
  document: AnnotationDocument;
  viewport: ImageAnnotationViewport;
  frame: number;
  instanceId: string | undefined;
  selectedPolygonId: string | undefined;
  onSelect: (polygon: Polygon) => void;
  tool: CanvasTool;
  focus: "all" | "instance" | "image";
  disabled: boolean;
  /** Recheck at gesture time: a global seek may be decoding before React receives endFrame. */
  canEdit: () => boolean;
  onWheel: (event: React.WheelEvent) => void;
};

type Drag = { polygon: Polygon; vertex: number; points: Point[]; pointerId: number };

/** SVG authoring layer over the existing WebGL image; all stored points stay in original pixels. */
export function PolygonCanvas(props: Props): React.JSX.Element {
  const {
    session,
    document,
    viewport,
    frame,
    instanceId,
    selectedPolygonId,
    onSelect,
    tool,
    focus,
    disabled,
    canEdit,
    onWheel,
  } = props;
  const [drawing, setDrawing] = useState<Point[]>([]);
  const [drag, setDrag] = useState<Drag | undefined>();
  const dragRef = useRef<Drag | undefined>();
  const polygons = document.frames[String(frame)] ?? [];
  const visible =
    focus === "image"
      ? []
      : polygons.filter((polygon) => focus === "all" || polygon.instanceId === instanceId);
  const color = (polygon: Polygon) =>
    document.classes.find(
      (item) =>
        item.id ===
        document.instances.find((instance) => instance.id === polygon.instanceId)?.classId,
    )?.color ?? "#58bfff";
  const screenPoints = (points: Point[]) =>
    points
      .map((point) => {
        const p = viewport.project(point);
        return `${p.x},${p.y}`;
      })
      .join(" ");
  const imagePoint = (event: React.PointerEvent<SVGSVGElement>): Point | undefined => {
    const rect = event.currentTarget.getBoundingClientRect();
    return viewport.unproject({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const finish = () => {
    if (drawing.length < 3 || instanceId == undefined || disabled || !canEdit()) {
      return;
    }
    session.edit((documentToEdit) => {
      (documentToEdit.frames[String(frame)] ??= []).push({
        id: crypto.randomUUID(),
        instanceId,
        points: drawing,
      });
    });
    setDrawing([]);
  };
  const cancelDrag = () => {
    dragRef.current = undefined;
    setDrag(undefined);
  };

  return (
    <svg
      aria-label="Spatial annotation canvas"
      role="application"
      tabIndex={0}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 2,
        outline: "none",
        pointerEvents: tool === "pan" ? "none" : "auto",
        cursor: disabled ? "not-allowed" : tool === "draw" ? "crosshair" : "default",
      }}
      onWheel={onWheel}
      onContextMenu={(event) => {
        event.preventDefault();
        finish();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish();
        }
        if (event.key === "Escape") {
          setDrawing([]);
          cancelDrag();
        }
        if (
          (event.key === "Backspace" || event.key === "Delete") &&
          selectedPolygonId != undefined &&
          tool === "select" &&
          !disabled &&
          canEdit()
        ) {
          event.preventDefault();
          session.edit((next) => {
            next.frames[String(frame)] = polygons.filter(
              (polygon) => polygon.id !== selectedPolygonId,
            );
          });
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.focus();
        if (event.button !== 0 || disabled || !canEdit()) {
          return;
        }
        if (tool === "draw") {
          const point = imagePoint(event);
          if (point != undefined && instanceId != undefined) {
            setDrawing((points) => [...points, point]);
          }
        }
      }}
      onPointerMove={(event) => {
        if (disabled || !canEdit()) {
          cancelDrag();
          return;
        }
        const current = dragRef.current;
        const point = imagePoint(event);
        if (current == undefined || point == undefined) {
          return;
        }
        const next = {
          ...current,
          points: current.points.map((existing, index) =>
            index === current.vertex ? point : existing,
          ),
        };
        dragRef.current = next;
        setDrag(next);
      }}
      onPointerUp={(event) => {
        const current = dragRef.current;
        if (current == undefined) {
          return;
        }
        if (!disabled && canEdit()) {
          session.edit((next) => {
            const polygon = next.frames[String(frame)]?.find(
              (item) => item.id === current.polygon.id,
            );
            if (polygon != undefined) {
              polygon.points = current.points;
            }
          });
        }
        cancelDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={cancelDrag}
    >
      <title>
        Click to draw. Enter or right-click completes. Escape cancels. Select a polygon to drag its
        vertices.
      </title>
      {visible.map((polygon) => {
        const selected = polygon.id === selectedPolygonId;
        const points = drag?.polygon.id === polygon.id ? drag.points : polygon.points;
        return (
          <g key={polygon.id}>
            <polygon
              aria-label={`Polygon ${polygon.id}`}
              points={screenPoints(points)}
              fill={color(polygon)}
              fillOpacity={selected ? 0.28 : 0.14}
              stroke={color(polygon)}
              strokeWidth={selected ? 3 : 1.5}
              style={{ pointerEvents: tool === "select" && !disabled ? "auto" : "none" }}
              onPointerDown={(event) => {
                if (tool === "select" && !disabled) {
                  event.stopPropagation();
                  event.currentTarget.ownerSVGElement?.focus();
                  onSelect(polygon);
                }
              }}
            />
            {selected &&
              tool === "select" &&
              !disabled &&
              points.map((point, index) => {
                const p = viewport.project(point);
                return (
                  <circle
                    key={index}
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill="white"
                    stroke={color(polygon)}
                    strokeWidth={2}
                    style={{ cursor: "move" }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !canEdit()) {
                        return;
                      }
                      event.stopPropagation();
                      const svg = event.currentTarget.ownerSVGElement;
                      svg?.focus();
                      svg?.setPointerCapture(event.pointerId);
                      const next = {
                        polygon,
                        vertex: index,
                        points: [...polygon.points],
                        pointerId: event.pointerId,
                      };
                      dragRef.current = next;
                      setDrag(next);
                    }}
                  />
                );
              })}
          </g>
        );
      })}
      {drawing.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={screenPoints(drawing)}
            fill="none"
            stroke="#ffe066"
            strokeWidth={2}
            strokeDasharray="5 3"
          />
          {drawing.map((point, index) => {
            const p = viewport.project(point);
            return <circle key={index} cx={p.x} cy={p.y} r={4} fill="#ffe066" />;
          })}
          <text x={12} y={80} fill="#ffe066">
            {drawing.length} vertices · Enter to finish · Esc to cancel
          </text>
        </g>
      )}
    </svg>
  );
}
