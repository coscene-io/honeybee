// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { memo } from "react";
import { makeStyles } from "tss-react/mui";

import type { Brush, QuickResult } from "./canvasTypes";
import type { EditorPoint } from "../../editorGeometry";
import { OVERLAY_COLORS } from "../../overlayColors";
import type { QuickPoint } from "../../quickSegment";

const useStyles = makeStyles()({ pixelated: { imageRendering: "pixelated" } });

type Scale = { width: number; height: number; screenScale: number };

/** The "+" shown on an edge where a click would insert a vertex. */
export const EdgeInsertIndicator = memo(function EdgeInsertIndicator({
  point,
  width,
  height,
  screenScale,
}: { point: EditorPoint } & Scale): React.JSX.Element {
  return (
    <g
      data-testid="edge-insert-indicator"
      aria-hidden="true"
      pointerEvents="none"
      transform={`translate(${point.x * width} ${point.y * height})`}
    >
      <circle
        r={7 / screenScale}
        fill="white"
        stroke={OVERLAY_COLORS.accent}
        strokeWidth={2 / screenScale}
      />
      <path
        d={`M${-3.5 / screenScale},0 H${3.5 / screenScale} M0,${-3.5 / screenScale} V${3.5 / screenScale}`}
        stroke={OVERLAY_COLORS.accentStrong}
        strokeWidth={1.8 / screenScale}
      />
    </g>
  );
});

/** The brush stroke in progress and the brush outline under the pointer. */
export const BrushOverlay = memo(function BrushOverlay({
  stroke,
  cursor,
  brush,
  sourceWidth,
  width,
  height,
  screenScale,
  peekOriginal,
}: {
  stroke: EditorPoint[] | undefined;
  cursor: EditorPoint | undefined;
  brush: Brush;
  /** Source image width in pixels, which the brush radius is measured in. */
  sourceWidth: number;
  peekOriginal: boolean;
} & Scale): React.JSX.Element {
  return (
    <>
      {stroke && stroke.length > 0 && (
        <path
          data-testid="brush-stroke"
          pointerEvents="none"
          d={`M ${stroke.map((p) => `${p.x * width} ${p.y * height}`).join(" L ")}`}
          fill="none"
          stroke={brush.mode === "paint" ? OVERLAY_COLORS.accent : OVERLAY_COLORS.erase}
          strokeOpacity={0.5}
          strokeWidth={(2 * brush.radius * width) / sourceWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {cursor && !peekOriginal && (
        <circle
          data-testid="brush-cursor"
          pointerEvents="none"
          cx={cursor.x * width}
          cy={cursor.y * height}
          r={(brush.radius * width) / sourceWidth}
          fill="none"
          stroke={brush.mode === "paint" ? "white" : OVERLAY_COLORS.erase}
          strokeWidth={1.5 / screenScale}
          strokeDasharray={
            brush.mode === "erase" ? `${4 / screenScale} ${3 / screenScale}` : undefined
          }
        />
      )}
    </>
  );
});

/** The rubber-band rectangle that selects the vertices it covers. */
export const SelectionRectangle = memo(function SelectionRectangle({
  a,
  b,
  width,
  height,
}: { a: EditorPoint; b: EditorPoint } & Omit<Scale, "screenScale">): React.JSX.Element {
  return (
    <rect
      data-testid="selection-rectangle"
      aria-hidden="true"
      pointerEvents="none"
      x={Math.min(a.x, b.x) * width}
      y={Math.min(a.y, b.y) * height}
      width={Math.abs(a.x - b.x) * width}
      height={Math.abs(a.y - b.y) * height}
      fill={OVERLAY_COLORS.accentFill}
      stroke={OVERLAY_COLORS.accent}
      strokeWidth={1}
      strokeDasharray="4 3"
      vectorEffect="non-scaling-stroke"
    />
  );
});

/** The quick tool's clicked points and the mask they produced. */
export const QuickAnnotationLayer = memo(function QuickAnnotationLayer({
  result,
  points,
  width,
  height,
  screenScale,
}: { result: QuickResult | undefined; points: QuickPoint[] } & Scale): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <g pointerEvents="none" data-testid="quick-annotation">
      {result && result.w > 0 && (
        <image
          // eslint-disable-next-line @coscene-io/link-target -- SVG image of the mask preview, not a link.
          href={result.url}
          x={(result.x0 * width) / result.mask.width}
          y={(result.y0 * height) / result.mask.height}
          width={(result.w * width) / result.mask.width}
          height={(result.h * height) / result.mask.height}
          preserveAspectRatio="none"
          className={classes.pixelated}
        />
      )}
      {points.map((p, index) => (
        <g key={index} data-quick-point={p.positive ? "positive" : "negative"}>
          <circle
            cx={p.x * width}
            cy={p.y * height}
            r={6 / screenScale}
            fill={p.positive ? OVERLAY_COLORS.positivePoint : OVERLAY_COLORS.negativePoint}
            stroke="white"
            strokeWidth={1.5 / screenScale}
          />
          <path
            d={
              p.positive
                ? `M ${p.x * width - 3 / screenScale} ${p.y * height} h ${6 / screenScale} M ${p.x * width} ${p.y * height - 3 / screenScale} v ${6 / screenScale}`
                : `M ${p.x * width - 3 / screenScale} ${p.y * height} h ${6 / screenScale}`
            }
            stroke="white"
            strokeWidth={1.5 / screenScale}
          />
        </g>
      ))}
    </g>
  );
});

/** The vertices placed so far of the polygon being drawn. */
export const DraftPolygonLayer = memo(function DraftPolygonLayer({
  draft,
  width,
  height,
  screenScale,
}: { draft: EditorPoint[] } & Scale): React.JSX.Element {
  return (
    <g pointerEvents="none">
      <polyline
        points={draft.map((p) => `${p.x * width},${p.y * height}`).join(" ")}
        fill="none"
        stroke="white"
        strokeWidth={4 / 3 / screenScale}
      />
      {draft.map((p, index) => (
        <circle
          key={index}
          cx={p.x * width}
          cy={p.y * height}
          r={5.25 / screenScale}
          fill={OVERLAY_COLORS.draftVertex}
        />
      ))}
    </g>
  );
});
