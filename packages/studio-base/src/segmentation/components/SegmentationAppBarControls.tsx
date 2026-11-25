// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { AppBarIconButton } from "@foxglove/studio-base/components/AppBar/AppBarIconButton";

import { useSegmentationEnabled } from "../featureFlag";
import { endSegmentationSession } from "../runtime";
import { mainSegmentationCanvas } from "../segmentationChrome";
import { useSegmentationHost, useSegmentationSession } from "../segmentationHostContext";
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
  const { t } = useTranslation("segmentation");
  const host = useSegmentationHost();
  const canvases = useStore(host.chrome, (state) => state.canvases);
  const open = useSegmentationSession((state) => state.open);
  // Annotations are read and saved only through the AnnotationService: the entry is offered only
  // with the rollout flag on and a cloud record open, and is hidden (not disabled) otherwise.
  const available = useSegmentationEnabled();
  const first = mainSegmentationCanvas(canvases);

  if (!open && (!available || first == undefined)) {
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
            onClick={() => {
              endSegmentationSession(host.session);
            }}
          >
            {t("endAnnotation")}
          </Button>
        </>
      ) : (
        <>
          <Button
            className={classes.button}
            variant="outlined"
            size="small"
            color="inherit"
            title={t("editSpatialAnnotation")}
            startIcon={<EditOutlinedIcon />}
            onClick={first?.enterInline}
          >
            {t("editSpatialAnnotation")}
          </Button>
          {canvases.length === 1 && (
            <AppBarIconButton
              title={t("maximizeAndEdit")}
              aria-label={t("maximizeAndEdit")}
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
