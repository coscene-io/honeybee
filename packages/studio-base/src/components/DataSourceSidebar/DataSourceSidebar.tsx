// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import {
  // IconButton,
  Tab,
  Tabs,
  styled as muiStyled,
  Divider,
  CircularProgress,
} from "@mui/material";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { EventsList } from "@foxglove/studio-base/components/DataSourceSidebar/CoSceneEventsList";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";
import Stack from "@foxglove/studio-base/components/Stack";
import WssErrorModal from "@foxglove/studio-base/components/WssErrorModal";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoSceneRecordStore, useRecord } from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
// import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

import { Playlist } from "./Playlist";
import { TopicList } from "./TopicList";
import { DataSourceInfoView } from "../DataSourceInfoView";
import { ProblemsList } from "../ProblemsList";

type Props = {
  disableToolbar?: boolean;
};

const useStyles = makeStyles()((theme) => ({
  tabContent: {
    flex: "auto",
  },
  dialogTitle: {
    display: "flex",
    justifyContent: "space-between",
    paddingRight: "",
  },
  dialogTitleText: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  closeDialogIcon: {
    cursor: "pointer",
  },
}));

const StyledTab = muiStyled(Tab)(({ theme }) => ({
  minHeight: 30,
  minWidth: theme.spacing(8),
  padding: theme.spacing(0, 1.5),
  color: theme.palette.text.secondary,
  fontSize: "0.6875rem",

  "&.Mui-selected": {
    color: theme.palette.text.primary,
  },
}));

const StyledTabs = muiStyled(Tabs)({
  minHeight: "auto",

  ".MuiTabs-indicator": {
    transform: "scaleX(0.5)",
    height: 2,
  },
});

const ProblemCount = muiStyled("div")(({ theme }) => ({
  backgroundColor: theme.palette.error.main,
  fontSize: theme.typography.caption.fontSize,
  color: theme.palette.error.contrastText,
  padding: theme.spacing(0.125, 0.75),
  borderRadius: 8,
}));

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectPlayerProblems = ({ playerState }: MessagePipelineContext) => playerState.problems;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectEventsSupported = (store: EventsStore) => store.eventsSupported;
const selectRecords = (state: CoSceneRecordStore) => state.record;
const selectBagFiles = (state: CoSceneRecordStore) => state.recordBagFiles;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const NoPlayableBagsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { classes } = useStyles();
  const { t } = useTranslation("cosPlaylist");
  const CurrentUrlState = useMessagePipeline(selectUrlState);
  const {
    coSceneContext: { currentOrganizationSlug },
  } = useConsoleApi();

  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://home.coscene.dev/${currentOrganizationSlug}/${CurrentUrlState?.parameters?.projectSlug}`
      : `/${currentOrganizationSlug}/${CurrentUrlState?.parameters?.projectSlug}`;

  const recordHref = `${projectHref}/records/${CurrentUrlState?.parameters?.recordId}`;

  return (
    <div>
      <Dialog
        open={open}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title" className={classes.dialogTitle}>
          <div className={classes.dialogTitleText}>
            <ReportProblemIcon color="error" />
            {t("noPlayableBag")}
          </div>

          <CloseIcon
            className={classes.closeDialogIcon}
            onClick={() => {
              onClose();
            }}
          />
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {t("noPlayableBagDesc")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={() => {
              window.open(recordHref);
            }}
          >
            {t("viewRecordDetails")}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t("refresh", { ns: "cosGeneral" })}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

type DataSourceSidebarTab = "topics" | "events" | "playlist" | "more" | "problems";

export default function DataSourceSidebar(props: Props): JSX.Element {
  const { disableToolbar = false } = props;
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const { currentUser } = useCurrentUser();
  const selectedEventId = useEvents(selectSelectedEventId);
  const [activeTab, setActiveTab] = useState<DataSourceSidebarTab>("playlist");
  const { classes } = useStyles();
  const record = useRecord(selectRecords);
  const bagFiles = useRecord(selectBagFiles);
  const { t } = useTranslation("dataSourceInfo");
  // const { dialogActions } = useWorkspaceActions();
  const [noPlayableBags, setNoPlayableBags] = useState<boolean>(false);

  const [enableNewTopNav = false] = useAppConfigurationValue<boolean>(AppSetting.ENABLE_NEW_TOPNAV);

  const eventsSupported = useEvents(selectEventsSupported);
  const showEventsTab = !enableNewTopNav && currentUser != undefined && eventsSupported;

  const isLoading = useMemo(
    () =>
      playerPresence === PlayerPresence.INITIALIZING ||
      playerPresence === PlayerPresence.RECONNECTING,
    [playerPresence],
  );

  const bags = useMemo(() => bagFiles.value ?? [], [bagFiles]);

  useEffect(() => {
    const playableBags = bags.filter((bag) => bag.startTime);

    if (!record.loading && playableBags.length === 0) {
      setNoPlayableBags(true);
    }
  }, [bags, record.loading]);

  useEffect(() => {
    if (playerPresence === PlayerPresence.ERROR || playerPresence === PlayerPresence.RECONNECTING) {
      setActiveTab("problems");
    } else if (showEventsTab && selectedEventId != undefined) {
      setActiveTab("events");
    }
  }, [playerPresence, showEventsTab, selectedEventId]);

  return (
    <SidebarContent
      disablePadding
      disableToolbar={disableToolbar}
      overflow="auto"
      title={t("dataSource")}
      trailingItems={[
        isLoading && (
          <Stack key="loading" alignItems="center" justifyContent="center" padding={1}>
            <CircularProgress size={18} variant="indeterminate" />
          </Stack>
        ),
        // <IconButton
        //   key="add-connection"
        //   color="primary"
        //   title="New connection"
        //   onClick={() => dialogActions.dataSource.open("start")}
        // >
        //   <AddIcon />
        // </IconButton>,
      ].filter(Boolean)}
    >
      <Stack fullHeight>
        {!disableToolbar && (
          <Stack paddingX={2} paddingBottom={2}>
            <DataSourceInfoView />
          </Stack>
        )}
        {playerPresence !== PlayerPresence.NOT_PRESENT && (
          <>
            <Stack flex={1}>
              {!disableToolbar && (
                <>
                  <StyledTabs
                    value={activeTab}
                    onChange={(_ev, newValue: DataSourceSidebarTab) => setActiveTab(newValue)}
                    textColor="inherit"
                  >
                    <StyledTab disableRipple label="Playlist" value="playlist" />
                    <StyledTab disableRipple label="Topics" value="topics" />
                    <StyledTab disableRipple label="Moment" value="events" />
                    {/* {showEventsTab && <StyledTab disableRipple label="Events" value="events" />} */}
                    <StyledTab
                      disableRipple
                      label={
                        <Stack direction="row" alignItems="baseline" gap={1}>
                          Problems
                          {playerProblems.length > 0 && (
                            <ProblemCount>{playerProblems.length}</ProblemCount>
                          )}
                        </Stack>
                      }
                      value="problems"
                    />
                  </StyledTabs>
                  <Divider />
                </>
              )}
              {activeTab === "playlist" && (
                <div className={classes.tabContent}>
                  <Playlist />
                </div>
              )}
              {activeTab === "topics" && (
                <div className={classes.tabContent}>
                  <TopicList />
                </div>
              )}
              {activeTab === "events" && (
                <div className={classes.tabContent}>
                  <EventsList />
                </div>
              )}
              {activeTab === "problems" && (
                <div className={classes.tabContent}>
                  <ProblemsList />
                </div>
              )}
            </Stack>
          </>
        )}
      </Stack>
      <NoPlayableBagsDialog
        open={noPlayableBags}
        onClose={() => {
          setNoPlayableBags(false);
        }}
      />
      <WssErrorModal playerProblems={playerProblems} />
    </SidebarContent>
  );
}
