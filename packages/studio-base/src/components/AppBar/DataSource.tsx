// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCircle16Filled } from "@fluentui/react-icons";
import ComputerIcon from "@mui/icons-material/Computer";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { CircularProgress, IconButton, Link, Breadcrumbs } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { UploadFile } from "@foxglove/studio-base/components/AppBar/UploadFile";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import WssErrorModal from "@foxglove/studio-base/components/WssErrorModal";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

import { EndTimestamp } from "./EndTimestamp";

const ICON_SIZE = 18;

const useStyles = makeStyles<void, "adornmentError">()((theme, _params, _classes) => ({
  sourceName: {
    font: "inherit",
    fontSize: theme.typography.body2.fontSize,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    padding: theme.spacing(1.5),
    paddingInlineEnd: theme.spacing(0.75),
    whiteSpace: "nowrap",
    maxHeight: "44px",
    minWidth: 0,
    color: theme.palette.appBar.text,
  },
  adornment: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    color: theme.palette.appBar.primary,
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  adornmentError: {
    color: theme.palette.error.main,
  },
  spinner: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    bottom: 0,
    margin: "auto",
  },
  textTruncate: {
    maxWidth: "60vw",
    overflow: "hidden",
  },
  iconButton: {
    padding: 0,
    position: "relative",
    zIndex: 1,
    fontSize: ICON_SIZE - 2,

    "svg:not(.MuiSvgIcon-root)": {
      fontSize: "1rem",
    },
  },
  breadcrumbs: {
    display: "flex",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: theme.palette.appBar.text,
  },
}));

const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlayerProblems = (ctx: MessagePipelineContext) => ctx.playerState.problems;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
// CoScene
const selectProject = (store: CoSceneProjectStore) => store.project;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectEnableList = (store: CoSceneBaseStore) => store.getEnableList();

export function DataSource(): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes, cx } = useStyles();

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerName = useMessagePipeline(selectPlayerName);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const seek = useMessagePipeline(selectSeek);
  // CoScene
  const project = useProject(selectProject);
  const urlState = useMessagePipeline(selectUrlState);

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const enableList = useBaseInfo(selectEnableList);

  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const { sidebarActions } = useWorkspaceActions();

  // A crude but correct proxy (for our current architecture) for whether a connection is live
  const isLiveConnection = seek == undefined;

  const reconnecting = playerPresence === PlayerPresence.RECONNECTING;
  const initializing = playerPresence === PlayerPresence.INITIALIZING;
  const error =
    playerPresence === PlayerPresence.ERROR ||
    playerProblems.some((problem) => problem.severity === "error");
  const loading = reconnecting || initializing;

  const playerDisplayName =
    initializing && playerName == undefined ? "Initializing..." : playerName;

  const hostName = urlState?.parameters?.hostName;
  const deviceLink = urlState?.parameters?.deviceLink ?? "";

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <div className={classes.sourceName}>{t("noDataSource")}</div>;
  }

  // CoScene
  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://dev.coscene.cn/${baseInfo.organizationSlug}/${baseInfo.projectSlug}`
      : `/${baseInfo.organizationSlug}/${baseInfo.projectSlug}`;

  const recordHref = `${projectHref}/records/${baseInfo.recordId}`;
  const jobHref = `${projectHref}/matrix/workflow-runs/${baseInfo.workflowRunsId}/job-runs/${baseInfo.jobRunsId}`;

  const secondaryHref = baseInfo.jobRunsDisplayName ? jobHref : recordHref;

  const breadcrumbs = [
    <Link
      href={projectHref}
      target="_blank"
      underline="hover"
      key="1"
      color="inherit"
      className={classes.breadcrumbs}
    >
      {project.value?.displayName}
    </Link>,
    <Link
      href={secondaryHref}
      target="_blank"
      underline="hover"
      key="2"
      color="inherit"
      className={classes.breadcrumbs}
    >
      {baseInfo.jobRunsDisplayName ?? baseInfo.recordDisplayName}
    </Link>,
  ];

  return (
    <>
      <WssErrorModal playerProblems={playerProblems} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName}>
          <div className={classes.textTruncate}>
            {enableList.uploadLocalFile === "ENABLE" ? (
              <Stack direction="row" alignItems="center" gap={1}>
                {playerDisplayName} <UploadFile />
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" gap={2}>
                <Breadcrumbs
                  separator={<NavigateNextIcon fontSize="small" />}
                  aria-label="breadcrumb"
                >
                  {baseInfo.projectSlug && baseInfo.warehouseSlug ? breadcrumbs : ""}
                  {isLiveConnection && (
                    <Link
                      href={deviceLink || "#"}
                      target="_blank"
                      underline="hover"
                      key="1"
                      color="inherit"
                      className={classes.breadcrumbs}
                    >
                      {hostName ?? playerDisplayName ?? t("unknown")}
                    </Link>
                  )}
                </Breadcrumbs>

                <IconButton
                  onClick={() => {
                    const url = window.location.href;
                    const studioUrl = url.replace(/^https?:\/\//i, "coscene://");
                    window.open(studioUrl, "_self");
                  }}
                >
                  <ComputerIcon />
                </IconButton>
              </Stack>
            )}
          </div>
          {isLiveConnection && (
            <>
              <span>/</span>
              <EndTimestamp />
            </>
          )}
        </div>
        <div className={cx(classes.adornment, { [classes.adornmentError]: error })}>
          {loading && (
            <CircularProgress
              size={ICON_SIZE}
              color="inherit"
              className={classes.spinner}
              variant="indeterminate"
            />
          )}
          {error && (
            <IconButton
              color="inherit"
              className={classes.iconButton}
              onClick={() => {
                sidebarActions.left.setOpen(true);
                sidebarActions.left.selectItem("problems");
              }}
            >
              <ErrorCircle16Filled />
            </IconButton>
          )}
        </div>
      </Stack>
    </>
  );
}
