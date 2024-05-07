// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Add from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoIcon from "@mui/icons-material/InfoOutlined";
import SearchIcon from "@mui/icons-material/Search";
import {
  AppBar,
  Button,
  IconButton,
  TextField,
  Typography,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
} from "@mui/material";
import { useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import CoSceneChooser from "@foxglove/studio-base/components/CoSceneChooser";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
  ParamsFile,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";

import { BagView } from "./BagView";

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectCurrentBagFiles = (state: CoScenePlaylistStore) => state.currentBagFiles;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectSetHoverBag = (store: TimelineInteractionStateStore) => store.setHoveredBag;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

const useStyles = makeStyles()((theme) => ({
  appBar: {
    top: -1,
    zIndex: theme.zIndex.appBar - 1,
    display: "flex",
    flexDirection: "row",
    padding: theme.spacing(1),
    gap: theme.spacing(1),
    alignItems: "center",
    marginLeft: "-1px",
  },
  root: {
    backgroundColor: theme.palette.background.paper,
    maxHeight: "100%",
  },
  addFileButton: {
    display: "flex",
    gap: theme.spacing(0.5),
    whiteSpace: "nowrap",
  },
  accordionTitle: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  accordion: {
    padding: 0,

    "&:before": {
      position: "absolute",
      left: "20px",
      top: "50px",
      display: "block",
      content: "''",
      width: "1px",
      height: "15px",
      backgroundColor: theme.palette.divider,
    },
  },
  accordionRoot: {
    "&.MuiAccordion-root": {
      boxShadow: "none !important",
    },
  },
  colorBlock: {
    width: "8px",
    height: "8px",
    borderRadius: "2px",
  },
  accordionSummary: {
    height: 44,
    minHeight: "44px !important",
    padding: "0 16px 0 16px",
    fontSize: "14px",
    fontWeight: 500,
    lineheight: "20px",
  },
  infoIcon: {
    width: "16px",
    height: "16px",
  },
}));

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", newStateUrl.href);
}

export function Playlist(): JSX.Element {
  const [filterText, setFilterText] = useState<string>("");
  const bagFiles = usePlaylist(selectBagFiles);
  const [addFileDialogOpen, setAddFileDialogOpen] = useState<boolean>(false);
  const currentBagFiles = usePlaylist(selectCurrentBagFiles);
  const seek = useMessagePipeline(selectSeek);
  const { classes } = useStyles();
  const { t } = useTranslation("cosPlaylist");
  const [confirm, confirmModal] = useConfirm();
  const consoleApi = useConsoleApi();

  const bagsAtHoverValue = useTimelineInteractionState(selectBagsAtHoverValue);
  const hoveredBag = useTimelineInteractionState(selectHoverBag);
  const setHoveredBag = useTimelineInteractionState(selectSetHoverBag);
  const urlState = useMessagePipeline(selectUrlState);
  const asyncBaseInfo = useBaseInfo(selectBaseInfo);

  const bags = useMemo(() => {
    const serialisationBags: Record<
      string,
      { projectDisplayName?: string; color?: string; subBags: BagFileInfo[] }
    > = {};

    bagFiles.value?.forEach((bag) => {
      if (bag.recordDisplayName) {
        if (serialisationBags[bag.recordDisplayName] == undefined) {
          serialisationBags[bag.recordDisplayName] = {
            projectDisplayName: bag.projectDisplayName,
            color: bag.recordColor,
            subBags: [bag],
          };
        } else {
          if (serialisationBags[bag.recordDisplayName]?.subBags != undefined) {
            serialisationBags[bag.recordDisplayName]!.subBags.push(bag);
          }
          if (serialisationBags[bag.recordDisplayName]?.color != undefined) {
            serialisationBags[bag.recordDisplayName]!.color = bag.recordColor;
          }
        }
      }
    });

    return serialisationBags;
  }, [bagFiles]);

  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const clearFilter = useCallback(() => {
    setFilterText("");
  }, [setFilterText]);

  const onClick = useCallback(
    (bag: BagFileInfo) => {
      if (seek && bag.startTime) {
        seek(bag.startTime);
      }
    },
    [seek],
  );

  const onHoverEnd = useCallback(() => {
    setHoveredBag(undefined);
  }, [setHoveredBag]);

  const onHoverStart = useCallback(
    (bag: BagFileInfo) => {
      setHoveredBag(bag);
    },
    [setHoveredBag],
  );

  const handleAddFiles = (selectedFiles: { filename: string; sha256: string }[]) => {
    const files: readonly ParamsFile[] = baseInfo.files ?? [];
    const fileNamesSet = new Set<{ filename: string; sha256: string }>();

    selectedFiles.forEach((file) => {
      fileNamesSet.add({
        filename: file.filename,
        sha256: file.sha256,
      });
    });

    files.forEach((bag) => {
      if ("filename" in bag) {
        fileNamesSet.add({ filename: bag.filename, sha256: bag.sha256 });
      }
    });

    const newFiles: ParamsFile[] = Array.from(fileNamesSet);

    files.forEach((bag) => {
      if ("jobRunsName" in bag) {
        newFiles.push({
          jobRunsName: bag.jobRunsName,
        });
      }
      if ("recordName" in bag) {
        newFiles.push({
          recordName: bag.recordName,
        });
      }
    });

    consoleApi
      .setBaseInfo({
        ...baseInfo,
        files: newFiles,
      })
      .then((key) => {
        if (urlState != undefined) {
          updateUrl({
            dsParams: {
              key,
            },
          });
          location.reload();
        } else {
          toast.error(t("addFilesFailed"));
        }
      })
      .catch((error) => {
        toast.error(t("addFilesFailed"));
        console.error("Failed to set base info", error);
      });
  };

  return (
    <Stack className={classes.root} fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          value={filterText}
          onChange={(event) => {
            setFilterText(event.currentTarget.value);
          }}
          size="small"
          placeholder={t("searchByNameTime")}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" />,
            endAdornment: filterText !== "" && (
              <IconButton edge="end" onClick={clearFilter} size="small">
                <ClearIcon fontSize="small" />
              </IconButton>
            ),
          }}
        />
        {urlState != undefined && (
          <Button
            className={classes.addFileButton}
            onClick={() => {
              setAddFileDialogOpen(true);
            }}
          >
            <Add /> {t("addFiles")}
          </Button>
        )}
      </AppBar>
      {bagFiles.loading && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <CircularProgress />
        </Stack>
      )}
      {bagFiles.error && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="error">
            {t("noLoadingBag")}
          </Typography>
        </Stack>
      )}
      {bagFiles.value && bagFiles.value.length === 0 && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            {t("noBag")}
          </Typography>
        </Stack>
      )}
      <div>
        {Object.keys(bags).map((recordDisplayName, index) => {
          return (
            <div key={recordDisplayName}>
              <Accordion defaultExpanded={index === 0} className={classes.accordionRoot}>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls="panel1-content"
                  id="panel1-header"
                  className={classes.accordionSummary}
                >
                  <div className={classes.accordionTitle}>
                    <span
                      className={classes.colorBlock}
                      style={{
                        backgroundColor: bags[recordDisplayName]?.color,
                      }}
                    />
                    {recordDisplayName}
                    <Tooltip
                      title={t("projectFrom", {
                        projectName: bags[recordDisplayName]?.projectDisplayName,
                      })}
                    >
                      <InfoIcon className={classes.infoIcon} />
                    </Tooltip>
                  </div>
                </AccordionSummary>

                <AccordionDetails className={classes.accordion}>
                  {(bags[recordDisplayName]?.subBags ?? []).map((bag) => {
                    return (
                      <BagView
                        key={bag.name}
                        bag={bag}
                        filter={filterText}
                        isHovered={
                          (hoveredBag && hoveredBag.name === bag.name) ??
                          bagsAtHoverValue[bag.name] != undefined
                        }
                        isCurrent={
                          currentBagFiles?.find((currentBag) => currentBag.name === bag.name) !=
                          undefined
                        }
                        updateUrl={updateUrl}
                        onClick={onClick}
                        onHoverStart={onHoverStart}
                        onHoverEnd={onHoverEnd}
                        confirm={confirm}
                      />
                    );
                  })}
                </AccordionDetails>
              </Accordion>
            </div>
          );
        })}
      </div>
      <CoSceneChooser
        open={addFileDialogOpen}
        closeDialog={() => {
          setAddFileDialogOpen(false);
        }}
        onConfirm={(files) => {
          const fileNames = files.map((file) => ({
            filename: file.file.name,
            sha256: file.file.sha256,
          }));

          handleAddFiles(fileNames);
        }}
        type="files"
      />
      {confirmModal}
    </Stack>
  );
}
