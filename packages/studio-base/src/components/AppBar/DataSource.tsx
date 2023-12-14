// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCircle20Filled } from "@fluentui/react-icons";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { CircularProgress, IconButton, Link, Breadcrumbs, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import WssErrorModal from "@foxglove/studio-base/components/WssErrorModal";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneRecordStore,
  useRecord,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { fonts } from "@foxglove/studio-base/util/sharedStyleConstants";

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
    maxWidth: "30vw",
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
  numericValue: {
    fontFeatureSettings: `${fonts.SANS_SERIF_FEATURE_SETTINGS}, "zero"`,
  },
  breadcrumbs: {
    maxWidth: "150px",
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
const selectRecord = (store: CoSceneRecordStore) => store.record;

export function DataSource(): JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes, cx } = useStyles();

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerName = useMessagePipeline(selectPlayerName);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const seek = useMessagePipeline(selectSeek);
  // CoScene
  const project = useProject(selectProject);
  const {
    coSceneContext: { currentOrganizationSlug },
  } = useConsoleApi();
  const urlState = useMessagePipeline(selectUrlState);
  const record = useRecord(selectRecord);

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

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <div className={classes.sourceName}>{t("noDataSource")}</div>;
  }

  // CoScene
  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://home.coscene.dev/${currentOrganizationSlug}/${urlState?.parameters?.projectSlug}`
      : `/${currentOrganizationSlug}/${urlState?.parameters?.projectSlug}`;
  const recordHref = `${projectHref}/records/${record.value?.getName().split("/").pop() ?? ""}`;

  const breadcrumbs = [
    <Link
      href={projectHref}
      target="_blank"
      underline="hover"
      key="1"
      color="inherit"
      className={classes.breadcrumbs}
    >
      {project.value?.getDisplayName()}
    </Link>,
    <Link
      href={recordHref}
      target="_blank"
      underline="hover"
      key="2"
      color="inherit"
      className={classes.breadcrumbs}
    >
      {record.value?.getTitle()}
    </Link>,
  ];

  return (
    <>
      <WssErrorModal playerProblems={playerProblems} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName}>
          <div className={classes.textTruncate}>
            {urlState?.parameters?.projectSlug && urlState.parameters.warehouseSlug ? (
              <Breadcrumbs
                separator={<NavigateNextIcon fontSize="small" />}
                aria-label="breadcrumb"
              >
                {breadcrumbs}
              </Breadcrumbs>
            ) : (
              <Typography className={classes.numericValue} variant="inherit">
                {isLiveConnection ? `${hostName ?? playerDisplayName}` : `<${t("unknown")}>`}
              </Typography>
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
              <ErrorCircle20Filled />
            </IconButton>
          )}
        </div>
      </Stack>
    </>
  );
}
