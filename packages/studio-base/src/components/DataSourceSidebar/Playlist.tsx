import { AppBar, IconButton, TextField, Typography, CircularProgress } from "@mui/material";
import {
  CoSceneRecordStore,
  useRecord,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import Stack from "@foxglove/studio-base/components/Stack";
import { makeStyles } from "tss-react/mui";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { BagView } from "./BagView";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";

import { useState, useCallback, useMemo } from "react";

const selectBagFiles = (state: CoSceneRecordStore) => state.recordBagFiles;
const selectCurrentBagFiles = (state: CoSceneRecordStore) => state.currentBagFiles;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectSetHoverBag = (store: TimelineInteractionStateStore) => store.setHoveredBag;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

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
    paddingBottom: "50px",
  },
}));

export function Playlist(): JSX.Element {
  const [filterText, setFilterText] = useState<string>("");
  const bagFiles = useRecord(selectBagFiles);
  const currentBagFiles = useRecord(selectCurrentBagFiles);
  const seek = useMessagePipeline(selectSeek);
  const { classes } = useStyles();

  const bagsAtHoverValue = useTimelineInteractionState(selectBagsAtHoverValue);
  const hoveredBag = useTimelineInteractionState(selectHoverBag);
  const setHoveredBag = useTimelineInteractionState(selectSetHoverBag);

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

  return (
    <Stack className={classes.root} fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          value={filterText}
          onChange={(event) => setFilterText(event.currentTarget.value)}
          placeholder="Search by name or time"
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" />,
            endAdornment: filterText !== "" && (
              <IconButton edge="end" onClick={clearFilter} size="small">
                <ClearIcon fontSize="small" />
              </IconButton>
            ),
          }}
        />
      </AppBar>
      {bagFiles.loading && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <CircularProgress />
        </Stack>
      )}
      {bagFiles.error && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="error">
            Error loading bag files.
          </Typography>
        </Stack>
      )}
      {bagFiles.value && bagFiles.value.length === 0 && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            No bag files.
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
                (hoveredBag && hoveredBag.name === bag.name) ||
                bagsAtHoverValue[bag.name] !== undefined
              }
              isCurrent={
                currentBagFiles?.find((currentBag) => currentBag.name === bag.name) !== undefined
              }
              onClick={onClick}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
            />
          );
        })}
      </div>
    </Stack>
  );
}
