// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import { Tab, Tabs, styled as muiStyled, Divider, Box } from "@mui/material";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Menu from "@mui/material/Menu";
import { useTheme } from "@mui/material/styles";
import { useState, PropsWithChildren, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { EventsList } from "@foxglove/studio-base/components/DataSourceSidebar/EventsList";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneRecordStore, useRecord } from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

import { DataSourceInfoView } from "../DataSourceInfoView";
import { Playlist } from "./Playlist";
import { ProblemsList } from "./ProblemsList";
import { TopicList } from "./TopicList";

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

const useStyles = makeStyles()((theme) => ({
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

const ProblemCount = muiStyled("div")(({ theme }) => ({
  backgroundColor: theme.palette.error.main,
  fontSize: theme.typography.caption.fontSize,
  color: theme.palette.error.contrastText,
  padding: theme.spacing(0.125, 0.75),
  borderRadius: 8,
}));

const TabPanel = (
  props: PropsWithChildren<{
    index: number;
    menuValue?: number;
    value: number;
  }>,
): JSX.Element => {
  const { children, value, index, menuValue, ...other } = props;

  return (
    <Box
      role="tabpanel"
      hidden={value !== index && menuValue !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      flex="auto"
      {...other}
    >
      {(value === index || index === menuValue) && <>{children}</>}
    </Box>
  );
};

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectPlayerProblems = ({ playerState }: MessagePipelineContext) => playerState.problems;
const selectPlayerSourceId = ({ playerState }: MessagePipelineContext) =>
  playerState.urlState?.sourceId;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectRecords = (state: CoSceneRecordStore) => state.record;
const selectBagFiles = (state: CoSceneRecordStore) => state.recordBagFiles;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const NoPlayableBagsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { classes } = useStyles();
  const { t } = useTranslation("dataSource");
  const CurrentUrlState = useMessagePipeline(selectUrlState);

  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://home.coscene.dev/${CurrentUrlState?.parameters?.warehouseSlug}/${CurrentUrlState?.parameters?.projectSlug}`
      : `/${CurrentUrlState?.parameters?.warehouseSlug}/${CurrentUrlState?.parameters?.projectSlug}`;

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
            {t("refresh", { ns: "general" })}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default function DataSourceSidebar(): JSX.Element {
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems) ?? [];
  const { currentUser } = useCurrentUser();
  const playerSourceId = useMessagePipeline(selectPlayerSourceId);
  const selectedEventId = useEvents(selectSelectedEventId);
  const [activeTab, setActiveTab] = useState(0);
  const [moreActiveTab, setMoreActiveTab] = useState(-1);
  const theme = useTheme();
  const { t } = useTranslation("dataSource");
  const record = useRecord(selectRecords);
  const bagFiles = useRecord(selectBagFiles);

  const [noPlayableBags, setNoPlayableBags] = useState<boolean>(false);

  const bags = useMemo(() => bagFiles.value ?? [], [bagFiles]);

  useEffect(() => {
    const playableBags = bags.filter((bag) => bag.startTime);

    if (!record.loading && playableBags.length === 0) {
      setNoPlayableBags(true);
    }
  }, [bags, record.loading]);

  const showEventsTab = currentUser != undefined && playerSourceId === "foxglove-data-platform";

  const [anchorEl, setAnchorEl] = React.useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(undefined);
  };

  useEffect(() => {
    if (playerPresence === PlayerPresence.ERROR || playerPresence === PlayerPresence.RECONNECTING) {
      setActiveTab(3);
      setMoreActiveTab(4);
    } else if (showEventsTab && selectedEventId != undefined) {
      setActiveTab(1);
    }
  }, [playerPresence, showEventsTab, selectedEventId]);

  return (
    <SidebarContent overflow="auto" title={t("dataSource")} disablePadding>
      <Stack fullHeight>
        <Stack paddingX={2} paddingBottom={2}>
          <DataSourceInfoView />
        </Stack>
        {playerPresence !== PlayerPresence.NOT_PRESENT && (
          <>
            <Stack flex={1}>
              <StyledTabs
                value={activeTab}
                onChange={(_ev, newValue: number) => {
                  setActiveTab(newValue);
                  setMoreActiveTab(-1);
                }}
                textColor="inherit"
              >
                <StyledTab disableRipple label={t("playlist")} value={0} />
                <StyledTab disableRipple label={t("topics")} value={1} />
                <StyledTab disableRipple label={t("moment")} value={2} />
                <Button
                  id="basic-button"
                  aria-controls={open ? "basic-menu" : undefined}
                  aria-haspopup="true"
                  aria-expanded={open ? "true" : undefined}
                  onClick={handleClick}
                  style={{
                    color:
                      activeTab === 3 ? theme.palette.text.primary : theme.palette.text.secondary,
                  }}
                >
                  {t("more")}
                </Button>
                <Menu
                  id="basic-menu"
                  anchorEl={anchorEl}
                  open={open}
                  onClose={handleClose}
                  MenuListProps={{
                    "aria-labelledby": "basic-button",
                  }}
                >
                  <StyledTab
                    label={
                      <Stack
                        direction="row"
                        style={{
                          color:
                            moreActiveTab === 3
                              ? theme.palette.text.primary
                              : theme.palette.text.secondary,
                        }}
                        alignItems="baseline"
                        gap={1}
                      >
                        {t("problem")}
                        {playerProblems.length > 0 && (
                          <ProblemCount>{playerProblems.length}</ProblemCount>
                        )}
                      </Stack>
                    }
                    onChange={() => {
                      setActiveTab(3);
                      setMoreActiveTab(4);
                    }}
                  />
                </Menu>
              </StyledTabs>
              <Divider />
              <TabPanel value={activeTab} index={0}>
                <Playlist />
              </TabPanel>
              <TabPanel value={activeTab} index={1}>
                <TopicList />
              </TabPanel>
              <TabPanel value={activeTab} index={2}>
                <EventsList />
              </TabPanel>
              <TabPanel value={activeTab} menuValue={moreActiveTab} index={4}>
                <ProblemsList problems={playerProblems} />
              </TabPanel>
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
    </SidebarContent>
  );
}
