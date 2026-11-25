// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  BrushOverlay,
  DraftPolygonLayer,
  EdgeInsertIndicator,
  QuickSegmentLayer,
  SelectionRectangle,
} from "./CanvasOverlays";
import { PolygonLayer } from "./PolygonLayer";
import { sourceSize } from "./canvasActions";
import type { CanvasContext } from "./canvasUi";
import type { CanvasActions } from "./useCanvasActions";

type SceneProps = {
  c: CanvasContext;
  actions: CanvasActions;
};

/** The layers drawn in image coordinates: polygons, handles, brush, selection, drafts. */
export function CanvasScene({ c, actions }: SceneProps): React.JSX.Element {
  const { ui, d, state } = c;
  const { size, screenScale, peekOriginal, hover } = ui;
  const { document, frame, frameId, drawing, locked, nativeView } = d;
  const scale = { width: size.width, height: size.height, screenScale };
  const visibleView = state.viewMode !== "original" && !peekOriginal;
  const dragged = ui.drag.current;
  const showEdgeIndicator =
    hover?.type === "edge" &&
    !locked &&
    state.editing &&
    state.viewMode !== "original" &&
    d.editsVertices(hover.instanceId, hover.polygonId) &&
    !drawing &&
    !ui.panTool &&
    !ui.spaceHeld &&
    !peekOriginal;
  return (
    <>
      {nativeView != undefined && c.props.disabled !== true && visibleView && document && (
        <PolygonLayer
          document={document}
          frameId={frameId}
          logTimeNs={frame?.logTimeNs}
          viewMode={state.viewMode}
          focus={state.focus}
          editing={state.editing}
          drawing={drawing != undefined}
          locked={locked}
          activePolygonId={d.activePolygonId}
          opacity={ui.opacity}
          preview={ui.preview}
          selectedVertices={ui.selectedVertices}
          hover={hover}
          draggedPolygonId={dragged?.type === "polygon" ? dragged.polygonId : undefined}
          draggedVertexIndex={dragged?.type === "polygon" ? dragged.vertex : undefined}
          {...scale}
          actions={actions}
        />
      )}
      {showEdgeIndicator && <EdgeInsertIndicator point={hover.point} {...scale} />}
      {d.brushActive && (
        <BrushOverlay
          stroke={ui.stroke}
          cursor={ui.brushCursor}
          brush={ui.brush}
          sourceWidth={sourceSize(c).width}
          peekOriginal={peekOriginal}
          {...scale}
        />
      )}
      {ui.marquee && <SelectionRectangle a={ui.marquee.a} b={ui.marquee.b} {...scale} />}
      {drawing && d.quickMode && visibleView && (
        <QuickSegmentLayer result={ui.quickResult} points={ui.quickPoints} {...scale} />
      )}
      {drawing && !d.quickMode && visibleView && <DraftPolygonLayer draft={ui.draft} {...scale} />}
    </>
  );
}
