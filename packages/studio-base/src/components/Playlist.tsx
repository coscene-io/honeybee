// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Add from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { AppBar, Button, IconButton, TextField, Typography, CircularProgress } from "@mui/material";
import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import CoSceneChooser from "@foxglove/studio-base/components/CoSceneChooser";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
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
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";

import { BagView } from "./BagView";

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectCurrentBagFiles = (state: CoScenePlaylistStore) => state.currentBagFiles;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectSetHoverBag = (store: TimelineInteractionStateStore) => store.setHoveredBag;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const useStyles = makeStyles()((theme) => ({
  appBar: {
    top: -1,
    zIndex: theme.zIndex.appBar - 1,
    display: "flex",
    flexDirection: "row",
    padding: theme.spacing(1),
    gap: theme.spacing(1),
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
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

  const bagsAtHoverValue = useTimelineInteractionState(selectBagsAtHoverValue);
  const hoveredBag = useTimelineInteractionState(selectHoverBag);
  const setHoveredBag = useTimelineInteractionState(selectSetHoverBag);
  const urlState = useMessagePipeline(selectUrlState);

  const bags = useMemo(() => bagFiles.value ?? [], [bagFiles]);

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

  const handleAddFiles = (fileNames: string[]) => {
    const files: ParamsFile[] = JSON.parse(urlState?.parameters?.files ?? "{}");
    const fileNamesSet = new Set(fileNames);

    files.forEach((bag) => {
      if ("filename" in bag) {
        fileNamesSet.add(bag.filename);
      }
    });

    const newFiles: ParamsFile[] = Array.from(fileNamesSet).map((fileName) => {
      return {
        filename: fileName,
      };
    });

    files.forEach((bag) => {
      if ("jobRunsName" in bag) {
        newFiles.push({
          jobRunsName: bag.jobRunsName,
        });
      }
    });

    if (urlState != undefined) {
      updateUrl({
        dsParams: {
          ...urlState.parameters,
          files: JSON.stringify(newFiles) ?? "",
        },
      });
    }

    location.reload();
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
        <Button
          className={classes.addFileButton}
          onClick={() => {
            setAddFileDialogOpen(true);
          }}
        >
          <Add /> {t("addFiles")}
        </Button>
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
        {bags.map((bag) => {
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
                currentBagFiles?.find((currentBag) => currentBag.name === bag.name) != undefined
              }
              updateUrl={updateUrl}
              onClick={onClick}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
            />
          );
        })}
      </div>
      <CoSceneChooser
        open={addFileDialogOpen}
        closeDialog={() => {
          setAddFileDialogOpen(false);
        }}
        onConfirm={(files) => {
          const fileNames = files.map((file) => file.file.name);
          handleAddFiles(fileNames);
        }}
        type="files"
      />
    </Stack>
  );
}