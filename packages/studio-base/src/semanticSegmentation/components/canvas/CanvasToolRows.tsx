// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Stack, Tooltip } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import type { Brush } from "./canvasTypes";
import type { CreationTool } from "../../types";

const useStyles = makeStyles()((theme) => ({
  toolRow: {
    alignSelf: "flex-start",
    alignItems: "center",
    padding: theme.spacing(0.25),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: theme.shadows[2],
    "& .MuiButton-root": { textTransform: "none", minWidth: 0 },
  },
  toolKey: {
    marginLeft: 4,
    opacity: 0.7,
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
  },
  toolLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingInline: 4,
    fontSize: theme.typography.caption.fontSize,
    "& input": { width: 80, accentColor: theme.palette.primary.main },
  },
}));

export type ToolRowActions = {
  switchTool: (tool: CreationTool) => void;
  setBrushMode: (mode: Brush["mode"]) => void;
  setBrushRadius: (radius: number) => void;
  convertToPolygons: () => void;
  convertToMask: () => void;
};

/** Polygon / SAM selector while drawing a new shape. */
export const CreationToolRow = memo(function CreationToolRow({
  tool,
  actions,
}: {
  tool: CreationTool;
  actions: Pick<ToolRowActions, "switchTool">;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <Stack
      direction="row"
      spacing={0.5}
      role="radiogroup"
      aria-label={t("creationTool")}
      data-testid="creation-tools"
      className={classes.toolRow}
    >
      {(
        [
          ["polygon", t("polygon"), "P"],
          ["quick", t("quickSam"), "Q"],
        ] as const
      ).map(([value, label, key]) => (
        <Button
          key={value}
          size="small"
          role="radio"
          aria-checked={tool === value}
          variant={tool === value ? "contained" : "text"}
          data-creation-tool={value}
          onClick={() => {
            actions.switchTool(value);
          }}
        >
          {label} <span className={classes.toolKey}>{key}</span>
        </Button>
      ))}
    </Stack>
  );
});

function BrushControls({
  brush,
  actions,
}: {
  brush: Brush;
  actions: Pick<ToolRowActions, "setBrushMode" | "setBrushRadius">;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <>
      {(
        [
          ["paint", t("brush"), "B"],
          ["erase", t("eraser"), "E"],
        ] as const
      ).map(([mode, label, key]) => (
        <Button
          key={mode}
          size="small"
          aria-pressed={brush.mode === mode}
          variant={brush.mode === mode ? "contained" : "text"}
          data-brush-mode={mode}
          onClick={() => {
            actions.setBrushMode(mode);
          }}
        >
          {label} <span className={classes.toolKey}>{key}</span>
        </Button>
      ))}
      <label className={classes.toolLabel}>
        {t("size")}
        <input
          aria-label={t("brushSize")}
          type="range"
          min={1}
          max={200}
          value={brush.radius}
          onChange={(event) => {
            actions.setBrushRadius(Number(event.target.value));
          }}
        />
        <span className={classes.toolKey}>{brush.radius}px</span>
      </label>
    </>
  );
}

/** Brush and eraser for masks, and the explicit mask / polygon conversion. */
export const EditToolRow = memo(function EditToolRow({
  brushActive,
  brush,
  observationKind,
  actions,
}: {
  brushActive: boolean;
  brush: Brush;
  observationKind: "mask" | "polygons" | undefined;
  actions: ToolRowActions;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <Stack direction="row" spacing={0.5} data-testid="edit-tools" className={classes.toolRow}>
      {brushActive && <BrushControls brush={brush} actions={actions} />}
      {observationKind === "mask" && (
        <Button size="small" data-tool="convert-to-polygons" onClick={actions.convertToPolygons}>
          {t("convertPolygons")}
        </Button>
      )}
      {observationKind === "polygons" && (
        <Tooltip describeChild title={t("rasterizeHint")}>
          <Button size="small" data-tool="convert-to-mask" onClick={actions.convertToMask}>
            {t("convertMask")}
          </Button>
        </Tooltip>
      )}
    </Stack>
  );
});
