import {
  AppBar,
  Box,
  IconButton,
  styled as muiStyled,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
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

import { useEffect, useState, useCallback } from "react";

const selectBagFiles = (state: CoSceneRecordStore) => state.recordBagFiles;
const selectCurrentBagFiles = (state: CoSceneRecordStore) => state.currentBagFiles;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;

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
}));

export function Playlist(): JSX.Element {
  const [filterText, setFilterText] = useState<string>("");
  const bagFiles = useRecord(selectBagFiles);
  const currentBagFiles = useRecord(selectCurrentBagFiles);
  const { classes } = useStyles();
  const hoveredBags = useTimelineInteractionState(selectBagsAtHoverValue);

  const clearFilter = useCallback(() => {
    setFilterText("");
  }, [setFilterText]);

  useEffect(() => {
    console.log("hoveredBags", hoveredBags);
  }, [hoveredBags]);

  return (
    <Stack className={classes.root} fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          value={filterText}
          onChange={(event) => setFilterText(event.currentTarget.value)}
          placeholder="Search by key, value, or key:value"
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
        {(bagFiles.value || []).map((bagFile) => {
          return <div key={bagFile.name}>{bagFile.displayName}</div>;
        })}
      </div>

      <div>currentBag: {currentBagFiles}</div>
      {/* <div>hoveredBags: {hoveredBags["test"] !== undefined}</div> */}
    </Stack>
  );
}
