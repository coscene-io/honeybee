// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { memo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import type { EditorPoint } from "../editorGeometry";
import type { HoverTarget, VertexRef } from "./canvasTypes";

export type VertexActions = {
  startShape: (
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    polygonId: string,
    points: EditorPoint[],
    vertex?: number,
  ) => void;
  hoverVertex: (target: HoverTarget) => void;
  leaveVertex: () => void;
  focusVertex: (polygonId: string, vertex: number) => void;
};

type VertexHandlesProps = {
  instanceId: string;
  polygonId: string;
  color: string;
  /** The polygon's stored points: what a press starts from. */
  stored: EditorPoint[];
  /** The points drawn, which follow the drag preview. */
  points: EditorPoint[];
  selectedVertices: readonly VertexRef[];
  /** Index of the vertex under the pointer, if it is on this polygon. */
  hoveredVertex: number | undefined;
  /** Index of the vertex being dragged, if it is on this polygon. */
  draggedVertex: number | undefined;
  width: number;
  height: number;
  screenScale: number;
  actions: VertexActions;
};

/** A grab target and its visible dot for each vertex of the polygon being edited. */
export const VertexHandles = memo(function VertexHandles(
  props: VertexHandlesProps,
): React.JSX.Element {
  const { instanceId, polygonId, color, stored, points, selectedVertices, actions } = props;
  const { width, height, screenScale } = props;
  const { t } = useTranslation("segmentation");
  return (
    <>
      {points.map((vertex, index) => {
        const selected = selectedVertices.some(
          (v) => v.polygonId === polygonId && v.vertex === index,
        );
        const highlighted = props.hoveredVertex === index || props.draggedVertex === index;
        return (
          <g key={index}>
            <circle
              aria-label={t("vertexLabel", { vertex: index + 1, polygon: polygonId })}
              role="button"
              tabIndex={-1}
              onPointerEnter={() => {
                actions.hoverVertex({
                  type: "vertex",
                  instanceId,
                  polygonId,
                  points: stored,
                  vertex: index,
                });
              }}
              onPointerLeave={actions.leaveVertex}
              onFocus={() => {
                actions.focusVertex(polygonId, index);
              }}
              cx={vertex.x * width}
              cy={vertex.y * height}
              r={8 / screenScale}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "grab" }}
              onPointerDown={(event) => {
                actions.startShape(event, instanceId, polygonId, stored, index);
              }}
            />
            <circle
              data-testid="vertex-handle-visible"
              data-highlighted={highlighted}
              data-selected={selected}
              aria-hidden="true"
              pointerEvents="none"
              cx={vertex.x * width}
              cy={vertex.y * height}
              r={4.5 / screenScale}
              fill={highlighted || selected ? color : "white"}
              stroke={highlighted || selected ? "white" : color}
              strokeWidth={1.5 / screenScale}
            />
          </g>
        );
      })}
    </>
  );
});
