// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CanvasNotices } from "./CanvasNotices";
import { CanvasScene } from "./CanvasScene";
import { cursorFor } from "./canvasMath";
import type { CanvasContext } from "./canvasUi";
import type { CanvasActions } from "./useCanvasActions";
import { OVERLAY_COLORS } from "../../overlayColors";

const useStyles = makeStyles()((theme) => ({
  viewport: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.palette.background.default,
    "&&:focus-visible": { outline: `2px solid ${OVERLAY_COLORS.focusRing}`, outlineOffset: -2 },
    background: "transparent",
  },
}));

type ViewportProps = {
  c: CanvasContext;
  actions: CanvasActions;
};

/** The overlay over the image: notices on top, then the SVG that receives the pointer. */
export function CanvasViewport({ c, actions }: ViewportProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const { ui, d } = c;
  const { nativeView, drawing } = d;
  const view = nativeView
    ? { width: nativeView.width, height: nativeView.height }
    : { width: ui.size.width, height: ui.size.height };
  return (
    <Box
      ref={ui.viewport}
      className={classes.viewport}
      data-testid="segmentation-viewport"
      tabIndex={0}
      role="group"
      aria-label={t("annotationViewport")}
      onPointerDownCapture={actions.viewportPointerDownCapture}
      onMouseDownCapture={actions.viewportMouseDownCapture}
      onBlur={actions.viewportBlur}
    >
      <CanvasNotices {...noticeProps(c, actions)} />
      <svg
        role="img"
        aria-label={t("framePolygons")}
        width="100%"
        height="100%"
        viewBox={`0 0 ${view.width} ${view.height}`}
        preserveAspectRatio={nativeView ? "none" : "xMidYMid meet"}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          touchAction: "none",
          cursor: cursorFor({
            panning: ui.panning,
            panTool: ui.panTool,
            spaceHeld: ui.spaceHeld,
            drawing: drawing != undefined,
            brushActive: d.brushActive,
            hover: ui.hover,
          }),
        }}
        onPointerLeave={actions.pointerLeave}
        onDoubleClick={actions.doubleClickMask}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDownCapture={actions.pointerDownCapture}
        onPointerDown={actions.pointerDown}
        onPointerMove={actions.pointerMove}
        onPointerUp={actions.pointerUp}
        onPointerCancel={actions.pointerCancel}
        onLostPointerCapture={actions.lostPointerCapture}
      >
        <g
          ref={ui.content}
          transform={
            nativeView
              ? `matrix(${nativeView.matrix.join(" ")})`
              : `translate(${ui.pan.x} ${ui.pan.y}) scale(${ui.zoom})`
          }
        >
          <CanvasScene c={c} actions={actions} />
        </g>
      </svg>
    </Box>
  );
}

/** Banner state, flattened to primitives so the memoized notices skip unrelated renders. */
function noticeProps(c: CanvasContext, actions: CanvasActions) {
  const { ui, d, state } = c;
  const drawing = d.drawing != undefined;
  const active = c.props.active ?? true;
  return {
    active,
    hasNativeView: d.nativeView != undefined,
    draftElsewhere: d.draftElsewhere,
    error: ui.error,
    notice: ui.notice,
    unreadableCount: d.unreadableHere.length,
    unreadableReason: d.unreadableHere[0]?.reason,
    drawing,
    quickMode: d.quickMode,
    locked: d.locked,
    tool: d.tool,
    showEditTools:
      state.editing &&
      !drawing &&
      active &&
      !d.locked &&
      d.focusedInstanceId != undefined &&
      state.viewMode !== "original",
    brushActive: d.brushActive,
    brush: ui.brush,
    observationKind: d.focusedObservation?.kind,
    showScopeHint:
      state.editing &&
      !drawing &&
      active &&
      !d.locked &&
      d.activePolygonId == undefined &&
      d.scopePolygons.length > 1 &&
      state.viewMode !== "original",
    scopePolygonsCount: d.scopePolygons.length,
    showHelp: ui.showHelp,
    actions,
  };
}
