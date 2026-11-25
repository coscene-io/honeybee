// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, Button, Stack, Typography } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CreationToolRow, EditToolRow } from "./CanvasToolRows";
import type { ToolRowActions } from "./CanvasToolRows";
import type { Brush } from "./canvasTypes";
import type { CreationTool } from "../../types";

const useStyles = makeStyles()((theme) => ({
  notices: {
    position: "absolute",
    inset: `${theme.spacing(1)} ${theme.spacing(1)} auto`,
    zIndex: 2,
    maxHeight: `calc(100% - ${theme.spacing(2)})`,
    overflowY: "auto",
    alignItems: "flex-end",
    pointerEvents: "none",
    "& > *": { pointerEvents: "auto", maxWidth: "min(600px, 100%)" },
  },
  chip: {
    alignSelf: "flex-start",
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.borderRadius,
    background: "rgba(0, 0, 0, 0.55)",
    color: "#fff",
    lineHeight: 1.6,
  },
  hint: {
    paddingBlock: 0,
    fontSize: theme.typography.caption.fontSize,
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    "& .MuiAlert-message": { paddingBlock: theme.spacing(0.5) },
    "& .MuiAlert-action": { paddingTop: 0, color: "#fff" },
  },
}));

export type NoticeActions = ToolRowActions & {
  dismissError: () => void;
  dismissNotice: () => void;
  setHelp: (value: "shown" | "hidden") => void;
};

export type NoticesProps = {
  /** False on canvases that do not hold the edit: they show no errors or drawing help. */
  active: boolean;
  hasNativeView: boolean;
  draftElsewhere: boolean;
  error: string | undefined;
  notice: string | undefined;
  unreadableCount: number;
  unreadableReason: string | undefined;
  drawing: boolean;
  quickMode: boolean;
  locked: boolean;
  tool: CreationTool;
  /** Editing the focused instance on a visible view: the brush and conversion row shows. */
  showEditTools: boolean;
  brushActive: boolean;
  brush: Brush;
  observationKind: "mask" | "polygons" | undefined;
  /** More than one polygon is in scope and none is active yet. */
  showScopeHint: boolean;
  scopePolygonsCount: number;
  showHelp: boolean;
  actions: NoticeActions;
};

function DrawingHelp({
  quickMode,
  showHelp,
  actions,
}: Pick<NoticesProps, "quickMode" | "showHelp" | "actions">): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return showHelp ? (
    <Alert
      severity="info"
      icon={false}
      className={classes.hint}
      onClose={() => {
        actions.setHelp("hidden");
      }}
    >
      {quickMode ? t("quickHelp") : t("polygonHelp")}
    </Alert>
  ) : (
    <Button
      size="small"
      onClick={() => {
        actions.setHelp("shown");
      }}
    >
      {t("drawingHelp")}
    </Button>
  );
}

/** Banners and tool rows floating over the top of the viewport. */
export const CanvasNotices = memo(function CanvasNotices(props: NoticesProps): React.JSX.Element {
  const { active, draftElsewhere, error, notice, drawing, locked, actions } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <Stack className={classes.notices} spacing={1} data-testid="canvas-notices">
      {!props.hasNativeView && <Alert severity="info">{t("viewTransformNotReady")}</Alert>}
      {draftElsewhere && (
        <Typography
          variant="caption"
          role="status"
          className={classes.chip}
          title={t("finishOtherCanvas")}
        >
          {t("drawingAnotherCamera")}
        </Typography>
      )}
      {error && active && (
        <Alert severity="error" onClose={actions.dismissError}>
          {error}
        </Alert>
      )}
      {notice && active && (
        <Alert severity="info" data-testid="geometry-notice" onClose={actions.dismissNotice}>
          {notice}
        </Alert>
      )}
      {props.unreadableCount > 0 && active && (
        <Alert severity="warning" data-testid="unreadable-observations">
          {t("unreadableAnnotations", {
            unreadableHereCount: props.unreadableCount,
            reason: props.unreadableReason,
          })}
        </Alert>
      )}
      {drawing && active && !draftElsewhere && !locked && (
        <CreationToolRow tool={props.tool} actions={actions} />
      )}
      {props.showEditTools && (
        <EditToolRow
          brushActive={props.brushActive}
          brush={props.brush}
          observationKind={props.observationKind}
          actions={actions}
        />
      )}
      {props.showScopeHint && (
        <Typography
          variant="caption"
          role="status"
          className={classes.chip}
          data-testid="choose-polygon-hint"
        >
          {t("scopePolygonsHint", { scopePolygonsCount: props.scopePolygonsCount })}
        </Typography>
      )}
      {drawing && active && !draftElsewhere && (
        <DrawingHelp quickMode={props.quickMode} showHelp={props.showHelp} actions={actions} />
      )}
    </Stack>
  );
});
