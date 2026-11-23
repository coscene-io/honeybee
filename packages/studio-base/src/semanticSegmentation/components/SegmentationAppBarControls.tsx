// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { Button, Tooltip } from "@mui/material";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { AppBarIconButton } from "@foxglove/studio-base/components/AppBar/AppBarIconButton";
import { isAnnotationRecordName } from "@foxglove/studio-base/util/coscene/annotation";

import { annotationRecord } from "../annotationRecord";
import { endSegmentationSession, segmentationSession } from "../runtime";
import { mainSegmentationCanvas, segmentationChrome } from "../segmentationChrome";
import { SegmentationActionMenu } from "./SegmentationActionMenu";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    marginLeft: theme.spacing(0.5),
    paddingLeft: theme.spacing(1),
    borderLeft: `1px solid ${theme.palette.divider}`,
    // The app bar forces white text; take its own text color so the light bar stays readable.
    color: theme.palette.appBar.text,
    WebkitAppRegion: "no-drag",
  },
  button: { whiteSpace: "nowrap" },
}));

/** Record-level annotation controls. They sit in the app bar, once, beside layout save and revert. */
export function SegmentationAppBarControls(): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const canvases = useStore(segmentationChrome, (state) => state.canvases);
  const open = useStore(segmentationSession, (state) => state.open);
  const recordName = useStore(annotationRecord, (state) => state.recordName);
  // Annotations are read and saved only through the AnnotationService.
  const annotatable = isAnnotationRecordName(recordName);
  const first = mainSegmentationCanvas(canvases);

  if (!open && first == undefined) {
    return undefined;
  }

  return (
    <div className={classes.root} data-testid="segmentation-app-bar">
      {open ? (
        <>
          <SegmentationActionMenu />
          <Button
            className={classes.button}
            size="small"
            color="inherit"
            onClick={endSegmentationSession}
          >
            结束标注
          </Button>
        </>
      ) : (
        <>
          <Tooltip title={annotatable ? "" : "只有云端记录支持空间标注"}>
            {/* A disabled button fires no events; the span keeps the tooltip working. */}
            <span>
              <Button
                className={classes.button}
                variant="outlined"
                size="small"
                color="inherit"
                title={annotatable ? "编辑空间标注" : "只有云端记录支持空间标注"}
                startIcon={<EditOutlinedIcon />}
                disabled={!annotatable}
                onClick={first?.enterInline}
              >
                编辑空间标注
              </Button>
            </span>
          </Tooltip>
          {canvases.length === 1 && (
            <AppBarIconButton
              title="放大并编辑空间标注"
              aria-label="放大并编辑空间标注"
              disabled={!annotatable}
              onClick={first?.enterMaximize}
            >
              <OpenInFullIcon fontSize="small" />
            </AppBarIconButton>
          )}
        </>
      )}
    </div>
  );
}
