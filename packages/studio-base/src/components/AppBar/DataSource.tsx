// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCircle16Filled, LinkMultipleFilled } from "@fluentui/react-icons";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import {
  CircularProgress,
  IconButton,
  Link,
  Breadcrumbs,
  Popover,
  Typography,
  Box,
  Paper,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppBarIconButton } from "@foxglove/studio-base/components/AppBar/AppBarIconButton";
import { UploadFile } from "@foxglove/studio-base/components/AppBar/UploadFile";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import WssErrorModal from "@foxglove/studio-base/components/WssErrorModal";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

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
  networkStatusPopover: {
    padding: theme.spacing(2),
    minWidth: 200,
    maxWidth: 300,
  },
  statusHeader: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  fluentIconPrimary: {
    color: theme.palette.primary.main,
  },
}));

const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlayerProblems = (ctx: MessagePipelineContext) => ctx.playerState.problems;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectNetworkStatus = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.networkStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectProject = (state: CoreDataStore) => state.project;
const selectRecord = (state: CoreDataStore) => state.record;
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const selectEnableList = (state: CoreDataStore) => state.getEnableList();
const selectOrganization = (state: CoreDataStore) => state.organization;
const selectJobRun = (state: CoreDataStore) => state.jobRun;

const UploadFileComponent = () => {
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerName = useMessagePipeline(selectPlayerName);

  const initializing = playerPresence === PlayerPresence.INITIALIZING;
  const playerDisplayName =
    initializing && playerName == undefined ? "Initializing..." : playerName;

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      {playerDisplayName} <UploadFile />
    </Stack>
  );
};

const Adornment = () => {
  const { classes, cx } = useStyles();
  const { sidebarActions } = useWorkspaceActions();

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];

  const reconnecting = playerPresence === PlayerPresence.RECONNECTING;
  const initializing = playerPresence === PlayerPresence.INITIALIZING;

  const error =
    playerPresence === PlayerPresence.ERROR ||
    playerProblems.some((problem) => problem.severity === "error");
  const loading = reconnecting || initializing;

  return (
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
  );
};

const RealTimeVizLinkState = () => {
  const { classes } = useStyles();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined);
  const urlState = useMessagePipeline(selectUrlState);
  const networkStatus = useMessagePipeline(selectNetworkStatus);
  const { t } = useTranslation("appBar");

  const linkType = urlState?.parameters?.linkType ?? "";
  const url = urlState?.parameters?.url ?? "";
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <AppBarIconButton
        color="inherit"
        onClick={handleClick}
        aria-describedby={open ? "network-status-popover" : undefined}
      >
        {linkType === "colink" ? (
          <SignalCellularAltIcon fontSize="small" />
        ) : (
          <LinkMultipleFilled fontSize={20} />
        )}
      </AppBarIconButton>

      <Popover
        id="network-status-popover"
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "center",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "center",
        }}
      >
        <Paper className={classes.networkStatusPopover}>
          <Box className={classes.statusHeader}>
            {linkType === "colink" ? (
              <SignalCellularAltIcon fontSize="small" color="primary" />
            ) : (
              <LinkMultipleFilled fontSize={16} className={classes.fluentIconPrimary} />
            )}
            <Typography variant="subtitle2" fontWeight="medium">
              {t("networkConnection")}
            </Typography>
          </Box>

          <Typography variant="body2" color="text.secondary" gutterBottom>
            {linkType === "colink" ? (
              <>{t("colinkRemoteConnection")}</>
            ) : (
              <>
                {t("localNetworkConnection")} {url && new URL(url).hostname}
              </>
            )}
          </Typography>

          {networkStatus && (
            <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                网络状态
              </Typography>
              {networkStatus.networkDelay != undefined && (
                <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
                  延迟: {networkStatus.networkDelay}ms
                </Typography>
              )}
              {networkStatus.curSpeed != undefined && (
                <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
                  速度: {networkStatus.curSpeed} KiB/s
                </Typography>
              )}
              {networkStatus.droppedMsgs != undefined && (
                <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
                  丢弃消息: {networkStatus.droppedMsgs}
                </Typography>
              )}
              {networkStatus.packageLoss != undefined && (
                <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
                  包丢失率: {networkStatus.packageLoss}
                </Typography>
              )}
            </Box>
          )}
        </Paper>
      </Popover>
    </>
  );
};

const RealTimeVizDataSource = () => {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");

  const playerPresence = useMessagePipeline(selectPlayerPresence);

  const urlState = useMessagePipeline(selectUrlState);
  const playerName = useMessagePipeline(selectPlayerName);

  const hostName = urlState?.parameters?.hostName;
  const deviceLink = urlState?.parameters?.deviceLink ?? "";

  const initializing = playerPresence === PlayerPresence.INITIALIZING;

  const playerDisplayName =
    initializing && playerName == undefined ? "Initializing..." : playerName;

  const linkType = urlState?.parameters?.linkType ?? "";

  return (
    <>
      {linkType !== "unknown" && <RealTimeVizLinkState />}
      <div className={classes.textTruncate}>
        <Stack direction="row" alignItems="center" gap={2}>
          <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
            <Link
              href={
                APP_CONFIG.DOMAIN_CONFIG.default?.webDomain
                  ? `https://${APP_CONFIG.DOMAIN_CONFIG.default.webDomain}/${deviceLink}`
                  : "#"
              }
              target="_blank"
              underline="hover"
              key="1"
              color="inherit"
              className={classes.breadcrumbs}
            >
              {hostName ?? playerDisplayName ?? t("unknown")}
            </Link>
          </Breadcrumbs>
        </Stack>
      </div>
      <span>/</span>
      <EndTimestamp />
    </>
  );
};

const CommonDataSource = () => {
  const { classes } = useStyles();

  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);
  const enableList = useCoreData(selectEnableList);
  const dataSource = useCoreData(selectDataSource);
  const organization = useCoreData(selectOrganization);
  const jobRun = useCoreData(selectJobRun);

  const recordId = useMemo(() => record.value?.name.split("/").pop(), [record]);
  const recordDisplayName = useMemo(() => record.value?.title, [record]);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);
  const jobRunDisplayName = useMemo(() => jobRun.value?.spec?.spec?.name, [jobRun]);

  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://dev.coscene.cn/${organizationSlug}/${projectSlug}`
      : `https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}/${organizationSlug}/${projectSlug}`;

  const secondaryHref = `${projectHref}/records/${recordId}`;

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
      {jobRunDisplayName ?? recordDisplayName}
    </Link>,
  ];

  return (
    <>
      <div className={classes.textTruncate}>
        {enableList.uploadLocalFile === "ENABLE" ? (
          <UploadFileComponent />
        ) : (
          <Stack direction="row" alignItems="center" gap={2}>
            <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
              {projectSlug && dataSource?.id === "coscene-data-platform" ? breadcrumbs : ""}
            </Breadcrumbs>
          </Stack>
        )}
      </div>
    </>
  );
};

export function DataSource(): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const seek = useMessagePipeline(selectSeek);

  // A crude but correct proxy (for our current architecture) for whether a connection is live
  const isLiveConnection = seek == undefined;

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <div className={classes.sourceName}>{t("noDataSource")}</div>;
  }

  return (
    <>
      <WssErrorModal playerProblems={playerProblems} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName}>
          {isLiveConnection ? <RealTimeVizDataSource /> : <CommonDataSource />}
        </div>
        <Adornment />
      </Stack>
    </>
  );
}
