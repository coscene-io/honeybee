// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { VertexHandles } from "./VertexHandles";
import type { VertexActions } from "./VertexHandles";
import type { HoverTarget, Preview, VertexRef } from "./canvasTypes";
import { polygonPath } from "../../editorGeometry";
import type { EditorPoint } from "../../editorGeometry";
import { polygonsOf } from "../../maskGeometry";
import { frameInstanceKey } from "../../service";
import type {
  SegmentationDocument,
  SegmentationInstance,
  SegmentationPolygon,
  SemanticSegmentationStore,
} from "../../types";
import { focusContains } from "../polygonEdit";

export type ShapeActions = VertexActions & {
  doubleClickPolygon: (event: ReactMouseEvent<SVGElement>, polygonId: string) => void;
};

/** What the layer needs to draw the shapes of every instance on the shown frame. */
export type PolygonLayerProps = {
  document: SegmentationDocument;
  frameId: string | undefined;
  logTimeNs: string | undefined;
  viewMode: SemanticSegmentationStore["viewMode"];
  focus: SemanticSegmentationStore["focus"];
  editing: boolean;
  /** A shape is being drawn: vertices cannot be edited meanwhile. */
  drawing: boolean;
  locked: boolean;
  activePolygonId: string | undefined;
  opacity: number;
  preview: Preview | undefined;
  selectedVertices: readonly VertexRef[];
  hover: HoverTarget | undefined;
  /** The vertex being dragged: its polygon and index. */
  draggedPolygonId: string | undefined;
  draggedVertexIndex: number | undefined;
  width: number;
  height: number;
  screenScale: number;
  actions: ShapeActions;
};

type InstanceShapesProps = Omit<PolygonLayerProps, "document"> & {
  document: SegmentationDocument;
  instance: SegmentationInstance;
  color: string;
};

type Emphasis = "active" | "scope" | "none";

const EMPHASIS_WIDTH: Record<Emphasis, number> = { active: 3, scope: 2, none: 1 };

type OutlineProps = Pick<
  InstanceShapesProps,
  "selectedVertices" | "width" | "height" | "screenScale" | "actions"
> & {
  instanceId: string;
  polygon: SegmentationPolygon;
  color: string;
  points: EditorPoint[];
  emphasis: Emphasis;
  editable: boolean;
  hoveredVertex: number | undefined;
  draggedVertex: number | undefined;
};

/** One polygon's outline, and its vertex handles while it is the one being edited. */
const PolygonOutline = memo(function PolygonOutline(props: OutlineProps): React.JSX.Element {
  const { instanceId, polygon, color, points, emphasis, editable, actions } = props;
  return (
    <g>
      <path
        d={polygonPath(points, props.width, props.height)}
        fill="none"
        stroke={color}
        strokeWidth={EMPHASIS_WIDTH[emphasis]}
        data-polygon-emphasis={emphasis}
        data-polygon-id={polygon.id}
        vectorEffect="non-scaling-stroke"
        pointerEvents="stroke"
        onPointerDown={(event) => {
          actions.startShape(event, instanceId, polygon.id, polygon.points);
        }}
        onDoubleClick={(event) => {
          actions.doubleClickPolygon(event, polygon.id);
        }}
      />
      {editable && (
        <VertexHandles
          instanceId={instanceId}
          polygonId={polygon.id}
          color={color}
          stored={polygon.points}
          points={points}
          selectedVertices={props.selectedVertices}
          hoveredVertex={props.hoveredVertex}
          draggedVertex={props.draggedVertex}
          width={props.width}
          height={props.height}
          screenScale={props.screenScale}
          actions={actions}
        />
      )}
    </g>
  );
});

/** The filled union, then the outlines, of one instance's polygons. */
const InstanceShapes = memo(function InstanceShapes(props: InstanceShapesProps): React.JSX.Element {
  const { document, instance, color, frameId, focus, viewMode, preview, actions } = props;
  const inFocus = (polygonId: string) =>
    focusContains(document, focus, frameId, instance.id, polygonId);
  const polygons =
    frameId == undefined
      ? []
      : polygonsOf(document.annotations[frameInstanceKey(frameId, instance.id)]);
  const visible = polygons.filter((polygon) => viewMode === "all" || inFocus(polygon.id));
  return (
    <g data-instance-id={instance.id} data-frame-id={frameId} data-log-time-ns={props.logTimeNs}>
      <g opacity={props.opacity} fill={color} data-testid="instance-union-fill">
        {visible.map((polygon) => (
          <path
            key={polygon.id}
            d={polygonPath(preview?.[polygon.id] ?? polygon.points, props.width, props.height)}
            onPointerDown={(event) => {
              actions.startShape(event, instance.id, polygon.id, polygon.points);
            }}
            onDoubleClick={(event) => {
              actions.doubleClickPolygon(event, polygon.id);
            }}
          />
        ))}
      </g>
      {visible.map((polygon) => {
        const focused = inFocus(polygon.id);
        const editable =
          props.editing &&
          polygon.id === props.activePolygonId &&
          focused &&
          !props.locked &&
          !props.drawing;
        // Active polygon: thickest outline and vertices; the rest of the edit scope
        // is highlighted; everything else is a thin outline.
        const emphasis: Emphasis =
          props.editing && !props.drawing && polygon.id === props.activePolygonId
            ? "active"
            : focused
              ? "scope"
              : "none";
        const hovered = props.hover;
        return (
          <PolygonOutline
            key={polygon.id}
            instanceId={instance.id}
            polygon={polygon}
            color={color}
            points={preview?.[polygon.id] ?? polygon.points}
            emphasis={emphasis}
            editable={editable}
            selectedVertices={props.selectedVertices}
            hoveredVertex={
              hovered?.type === "vertex" && hovered.polygonId === polygon.id
                ? hovered.vertex
                : undefined
            }
            draggedVertex={
              props.draggedPolygonId === polygon.id ? props.draggedVertexIndex : undefined
            }
            width={props.width}
            height={props.height}
            screenScale={props.screenScale}
            actions={actions}
          />
        );
      })}
    </g>
  );
});

/** Every instance's polygons on the shown frame. */
export function PolygonLayer(props: PolygonLayerProps): React.JSX.Element {
  const { document } = props;
  return (
    <>
      {document.instances.map((instance) => (
        <InstanceShapes
          key={instance.id}
          {...props}
          document={document}
          instance={instance}
          color={document.classes.find((item) => item.id === instance.classId)?.color ?? "#00897b"}
        />
      ))}
    </>
  );
}
