// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCircle16Filled, LinkMultipleFilled } from "@fluentui/react-icons";
import HelpIcon from "@mui/icons-material/HelpOutlined";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import {
  CircularProgress,
  IconButton,
  Link,
  Popover,
  Typography,
  Box,
  Paper,
  Tooltip,
  Divider,
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
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

const ICON_SIZE = 18;

const useStyles = makeStyles<void, "adornmentError">()((theme, _params, _classes) => ({
  sourceName: {
    font: "inherit",
    fontSize: theme.typography.body2.fontSize,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    paddingInlineEnd: theme.spacing(0.75),
    whiteSpace: "nowrap",
    maxHeight: "44px",
    minWidth: 0,
    overflow: "hidden",
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
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    maxWidth: "240px",
  },
  uploadFileIcon: {
    flexShrink: 0,
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
  networkStatus: {
    marginTop: theme.spacing(1),
    paddingTop: theme.spacing(1),
    borderTop: 1,
    borderColor: "divider",
  },
}));

const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlayerProblems = (ctx: MessagePipelineContext) => ctx.playerState.problems;
const selectNetworkStatus = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.networkStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectProject = (state: CoreDataStore) => state.project;
const selectRecord = (state: CoreDataStore) => state.record;
const selectDevice = (state: CoreDataStore) => state.device;
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const selectOrganization = (state: CoreDataStore) => state.organization;
const selectJobRun = (state: CoreDataStore) => state.jobRun;

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

  // 格式化网络速度
  const formatSpeed = (speedKiBs: number): string => {
    if (speedKiBs < 1) {
      return `${(speedKiBs * 1024).toFixed(2)} B/s`;
    } else if (speedKiBs < 1024) {
      return `${speedKiBs.toFixed(2)} KiB/s`;
    } else {
      return `${(speedKiBs / 1024).toFixed(2)} MiB/s`;
    }
  };

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
            {linkType === "colink" && <>{t("colinkRemoteConnection")}</>}
            {linkType === "other" && (
              <>
                {t("localNetworkConnection")} {url && new URL(url).hostname}
              </>
            )}
          </Typography>

          <Box className={classes.networkStatus}>
            <Stack direction="row" alignItems="center" gap={0.5} paddingBottom={0.5}>
              <Typography variant="subtitle2" fontWeight="medium">
                {t("networkStatus")}
              </Typography>
              <Tooltip title={t("networkStatusHelp")}>
                <HelpIcon fontSize="small" />
              </Tooltip>
            </Stack>

            <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
              <Stack direction="row" justifyContent="space-between">
                <span>{t("networkDelay")}:</span>
                {networkStatus?.networkDelay != undefined ? (
                  <span>{networkStatus.networkDelay.toFixed(2)}ms</span>
                ) : (
                  <span>-</span>
                )}
              </Stack>
            </Typography>
            <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
              <Stack direction="row" justifyContent="space-between">
                <span>{t("networkSpeed")}:</span>
                {networkStatus?.curSpeed != undefined ? (
                  <span>{formatSpeed(networkStatus.curSpeed)}</span>
                ) : (
                  <span>-</span>
                )}
              </Stack>
            </Typography>
            <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
              <Stack direction="row" justifyContent="space-between">
                <span>{t("droppedMessages")}:</span>
                {networkStatus?.droppedMsgs != undefined ? (
                  <span>{networkStatus.droppedMsgs}</span>
                ) : (
                  <span>-</span>
                )}
              </Stack>
            </Typography>
            <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
              <Stack direction="row" justifyContent="space-between">
                <span>{t("packetLoss")}:</span>
                {networkStatus?.packageLoss != undefined ? (
                  <span>{(networkStatus.packageLoss * 100).toFixed(2)}%</span>
                ) : (
                  <span>-</span>
                )}
              </Stack>
            </Typography>
          </Box>
        </Paper>
      </Popover>
    </>
  );
};

const RealTimeVizDataSource = () => {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");

  const domainConfig = getDomainConfig();

  const playerPresence = useMessagePipeline(selectPlayerPresence);

  const urlState = useMessagePipeline(selectUrlState);
  const playerName = useMessagePipeline(selectPlayerName);

  const project = useCoreData(selectProject);
  const projectDisplayName = useMemo(() => project.value?.displayName, [project]);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const organization = useCoreData(selectOrganization);
  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);
  const device = useCoreData(selectDevice);
  const deviceId = useMemo(() => device.value?.name.split("/").pop(), [device]);

  const hostName = urlState?.parameters?.hostName;

  const initializing = playerPresence === PlayerPresence.INITIALIZING;

  const playerDisplayName =
    initializing && playerName == undefined ? "Initializing..." : playerName;

  const projectHref =
    domainConfig.webDomain && organizationSlug && projectSlug
      ? `https://${domainConfig.webDomain}/${organizationSlug}/${projectSlug}`
      : undefined;
  const deviceHref =
    projectHref && deviceId ? `${projectHref}/devices/project-devices/${deviceId}` : undefined;

  return (
    <>
      <RealTimeVizLinkState />
      {projectDisplayName && !isDesktopApp() && (
        <>
          {projectHref ? (
            <Link
              href={projectHref}
              target="_blank"
              underline="hover"
              color="inherit"
              className={classes.ellipsis}
            >
              {project.value?.displayName}
            </Link>
          ) : (
            <div className={classes.ellipsis}>{project.value?.displayName}</div>
          )}
          <Divider orientation="vertical" flexItem style={{ height: "24px" }} />
        </>
      )}
      {deviceHref ? (
        <Link
          href={deviceHref}
          target="_blank"
          underline="hover"
          color="inherit"
          className={classes.ellipsis}
        >
          {hostName ?? playerDisplayName ?? t("unknown")}
        </Link>
      ) : (
        <div className={classes.ellipsis}>{hostName ?? playerDisplayName ?? t("unknown")}</div>
      )}
    </>
  );
};

const DataPlatformSource = () => {
  const { classes } = useStyles();
  const domainConfig = getDomainConfig();

  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);
  const jobRun = useCoreData(selectJobRun);

  const recordId = useMemo(() => record.value?.name.split("/").pop(), [record]);
  const recordDisplayName = useMemo(() => record.value?.title, [record]);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const jobRunDisplayName = useMemo(() => jobRun.value?.spec?.spec?.name, [jobRun]);

  const organization = useCoreData(selectOrganization);
  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);

  const projectHref =
    process.env.NODE_ENV === "development"
      ? organizationSlug && projectSlug
        ? `https://dev.coscene.cn/${organizationSlug}/${projectSlug}`
        : undefined
      : domainConfig.webDomain && organizationSlug && projectSlug
      ? `https://${domainConfig.webDomain}/${organizationSlug}/${projectSlug}`
      : undefined;

  const secondaryHref = projectHref && recordId ? `${projectHref}/records/${recordId}` : undefined;

  return (
    <>
      {!isDesktopApp() && (
        <>
          {projectHref ? (
            <Link
              href={projectHref}
              target="_blank"
              underline="hover"
              color="inherit"
              className={classes.ellipsis}
            >
              {project.value?.displayName}
            </Link>
          ) : (
            <div className={classes.ellipsis}>{project.value?.displayName}</div>
          )}
          <Divider orientation="vertical" flexItem style={{ height: "24px" }} />
        </>
      )}
      {secondaryHref ? (
        <Link
          href={secondaryHref}
          target="_blank"
          underline="hover"
          color="inherit"
          className={classes.ellipsis}
        >
          {jobRunDisplayName ?? recordDisplayName}
        </Link>
      ) : (
        <div className={classes.ellipsis}>{jobRunDisplayName ?? recordDisplayName}</div>
      )}
    </>
  );
};

const CommonDataSource = () => {
  const { classes } = useStyles();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerName = useMessagePipeline(selectPlayerName);

  const initializing = playerPresence === PlayerPresence.INITIALIZING;
  const playerDisplayName =
    initializing && playerName == undefined ? "Initializing..." : playerName;

  return (
    <>
      <span className={classes.ellipsis}>{playerDisplayName}</span>
      <span className={classes.uploadFileIcon}>
        <UploadFile />
      </span>
    </>
  );
};

export function DataSource(): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const dataSource = useCoreData(selectDataSource);

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <div className={classes.sourceName}>{t("noDataSource")}</div>;
  }

  return (
    <>
      <WssErrorModal playerProblems={playerProblems} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName}>
          {(() => {
            switch (dataSource?.id) {
              case "coscene-websocket":
                return <RealTimeVizDataSource />;
              case "persistent-cache":
                return <>{t("realTimeVizPlayback", { ns: "cosWebsocket" })}</>;
              case "coscene-data-platform":
                return <DataPlatformSource />;
              default:
                return <CommonDataSource />;
            }
          })()}
        </div>
        <Adornment />
      </Stack>
    </>
  );
}
