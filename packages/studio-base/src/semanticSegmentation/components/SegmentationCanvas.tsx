// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { annotationViewportProps } from "../annotationInput";
import { segmentationSession } from "../runtime";
import { CanvasContextMenu } from "./canvas/CanvasContextMenu";
import { CanvasToolsPanel } from "./canvas/CanvasToolsPanel";
import { CanvasViewport } from "./canvas/CanvasViewport";
import { MaskConversionDialog } from "./canvas/MaskConversionDialog";
import { deriveCanvas } from "./canvas/canvasDerive";
import { useCanvasState } from "./canvas/canvasState";
import type { SegmentationCanvasProps } from "./canvas/canvasTypes";
import { useCanvasUi } from "./canvas/canvasUi";
import type { CanvasContext } from "./canvas/canvasUi";
import { useCanvasActions } from "./canvas/useCanvasActions";
import { useCanvasEffects } from "./canvas/useCanvasEffects";

const useStyles = makeStyles()(() => ({
  root: {
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    outline: "none",
    overflow: "hidden",
    position: "relative",
    "& circle:focus": { outline: "none" },
  },
}));

/**
 * The annotation overlay of an image: polygons and their handles, the brush, quick annotation, the
 * view tools and the context menu. State lives in `canvas/canvasUi`, what follows from it in
 * `canvas/canvasDerive`, the handlers in the other `canvas/` modules.
 */
export function SegmentationCanvas(props: SegmentationCanvasProps): React.JSX.Element {
  const { store, disabled = false, active = true } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const state = useCanvasState(store);
  const ui = useCanvasUi(props.viewportRef);
  const strokeFrameId = useStore(segmentationSession, (session) => session.strokeFrameId);
  const d = deriveCanvas({
    state,
    shownFrameId: props.frameId,
    imageUrl: props.imageUrl,
    decodedFrame: props.decodedFrame,
    disabled,
    panTool: ui.panTool,
    selectedVertices: ui.selectedVertices,
    strokeFrameId,
  });
  const c: CanvasContext = { store, props: { ...props, disabled, active }, state, ui, d, t };
  useCanvasEffects(c);
  const actions = useCanvasActions(c);
  const menuTarget = ui.contextMenu?.target;
  return (
    <Stack
      ref={ui.root}
      tabIndex={-1}
      aria-label={t("canvasLabel")}
      {...annotationViewportProps}
      className={classes.root}
      onKeyDown={actions.keyDown}
      onKeyUp={actions.keyUp}
    >
      <CanvasToolsPanel
        open={ui.toolsOpen}
        atFit={ui.zoom === 1 && ui.pan.x === 0 && ui.pan.y === 0}
        screenScale={ui.screenScale}
        width={ui.size.width}
        height={ui.size.height}
        navigationLocked={d.navigationLocked}
        hasFocus={state.focus != undefined}
        panTool={ui.panTool}
        opacity={ui.opacity}
        actions={actions}
      />
      <CanvasViewport c={c} actions={actions} />
      <MaskConversionDialog
        conversion={ui.conversion}
        onClose={actions.closeConversion}
        onConfirm={actions.confirmConversion}
      />
      <CanvasContextMenu
        menu={ui.contextMenu}
        canDeleteVertex={
          !d.locked &&
          state.editing &&
          d.drawing == undefined &&
          (menuTarget?.points.length ?? 0) > 3
        }
        drawing={d.drawing != undefined}
        quickMode={d.quickMode}
        finishDisabled={
          d.locked || (d.quickMode ? !ui.quickResult || ui.quickBusy : ui.draft.length < 3)
        }
        hasFocus={state.focus != undefined}
        actions={actions}
      />
    </Stack>
  );
}
