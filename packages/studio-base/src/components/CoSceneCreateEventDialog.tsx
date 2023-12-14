// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  FormControlLabel,
  TextField,
  ToggleButtonGroup,
  Typography,
  FormLabel,
  FormControl,
  IconButton,
  ButtonGroup,
} from "@mui/material";
import { Timestamp } from "google-protobuf/google/protobuf/timestamp_pb";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";
import { useImmer } from "use-immer";

import { toDate } from "@foxglove/rostime";
import { CreateTaskDialog } from "@foxglove/studio-base/components/CreateTaskDialog";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneRecordStore,
  useRecord,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";

const fadeInAnimation = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const useStyles = makeStyles<void, "toggleButton">()((theme, _params, classes) => ({
  grid: {
    alignItems: "center",
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto",
    gap: theme.spacing(1),
    overflow: "auto",
    alignContent: "flex-start",
  },
  row: {
    animation: `${fadeInAnimation} 0.2s ease-in-out`,
    display: "contents",
  },
  toggleButton: {
    border: "none",
    lineHeight: 1,
  },
  toggleButtonGroup: {
    marginRight: theme.spacing(-1),
    gap: theme.spacing(0.25),

    [`.${classes.toggleButton}`]: {
      borderRadius: `${theme.shape.borderRadius}px !important`,
      marginLeft: "0px !important",
      borderLeft: "none !important",
    },
  },
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
}));

type KeyValue = { key: string; value: string };

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectRecord = (state: CoSceneRecordStore) => state.record;

export function CreateEventDialog(props: { onClose: () => void }): JSX.Element {
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" &&
    localStorage.getItem("honeybeeDemoStatus") === "start";

  const { onClose } = props;
  const urlState = useMessagePipeline(selectUrlState);
  const { t } = useTranslation("cosEvent");
  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);

  const { classes } = useStyles();
  const consoleApi = useConsoleApi();

  const refreshEvents = useEvents(selectRefreshEvents);
  const record = useRecord(selectRecord);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [event, setEvent] = useImmer<{
    eventName: string;
    startTime: undefined | Date;
    duration: undefined | number;
    durationUnit: "sec" | "nsec";
    description: undefined | string;
    metadataEntries: KeyValue[];
    enabledCreateNewTask: boolean;
  }>({
    eventName: "",
    startTime: currentTime ? toDate(currentTime) : undefined,
    duration: 1,
    durationUnit: "sec",
    description: "",
    metadataEntries: [{ key: "", value: "" }],
    enabledCreateNewTask: false,
  });

  const [task, setTask] = useImmer<{
    enabled: boolean;
    eventName: string;
    title: string;
    description: string;
  }>({
    enabled: false,
    eventName: "",
    title: "",
    description: "",
  });

  const [targetEvent, setTargetEvent] = useState<Event | undefined>(undefined);

  const updateMetadata = useCallback(
    (index: number, updateType: keyof KeyValue, value: string) => {
      setEvent((draft) => {
        const keyval = draft.metadataEntries[index];
        if (keyval) {
          keyval[updateType] = value;

          // Automatically add new row if we're at the end and have both key and value.
          if (
            index === draft.metadataEntries.length - 1 &&
            keyval.key.length > 0 &&
            keyval.value.length > 0
          ) {
            draft.metadataEntries.push({ key: "", value: "" });
          }
        }
      });
    },
    [setEvent],
  );

  const { formatTime } = useAppTimeFormat();

  const countedMetadata = _.countBy(event.metadataEntries, (kv) => kv.key);
  const duplicateKey = Object.entries(countedMetadata).find(
    ([key, count]) => key.length > 0 && count > 1,
  );
  const canSubmit = event.startTime != undefined && event.duration != undefined && !duplicateKey;
  const { enqueueSnackbar } = useSnackbar();

  const [createdEvent, createEvent] = useAsyncFn(async () => {
    if (event.startTime == undefined || event.duration == undefined) {
      return;
    }

    const filteredMeta = event.metadataEntries.filter(
      (entry) => entry.key.length > 0 && entry.value.length > 0,
    );
    const keyedMetadata = Object.fromEntries(
      filteredMeta.map((entry) => [entry.key.trim(), entry.value.trim()]),
    );

    const jobRunsId = urlState?.parameters?.jobRunsId;
    const workflowRunsId = urlState?.parameters?.workflowRunsId;
    const revisionId = urlState?.parameters?.revisionId;
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
    const recordName = record.value?.getName() ?? "";

    const newEvent = new Event();

    newEvent.setDisplayName(event.eventName);
    const timestamp = new Timestamp();

    timestamp.fromDate(event.startTime);

    newEvent.setTriggerTime(timestamp);

    if (event.durationUnit === "sec") {
      newEvent.setDuration(event.duration);
    } else {
      newEvent.setDuration(event.duration / 1e9);
    }

    if (event.description) {
      newEvent.setDescription(event.description);
    }

    if (jobRunsId && workflowRunsId) {
      newEvent.setJobRun(
        `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/workflowRuns/${workflowRunsId}/jobRuns/${jobRunsId}`,
      );
    }

    if (revisionId) {
      newEvent.setRevision(`${recordName}/revisions/${revisionId}`);
    }

    Object.keys(keyedMetadata).forEach((key) => {
      newEvent.getCustomizedFieldsMap().set(key, keyedMetadata[key] ?? "");
    });

    try {
      const result = await consoleApi.createEvent({
        event: newEvent,
        parent,
        recordName,
      });

      const eventName = result.getName();
      setTargetEvent(result);
      if (event.enabledCreateNewTask) {
        setTask({
          enabled: true,
          eventName,
          title: event.eventName,
          description: event.description ?? "",
        });
      } else {
        onClose();
      }

      refreshEvents();
      enqueueSnackbar(t("createMomentSuccess"), { variant: "success" });
    } catch (e) {
      enqueueSnackbar(t("createMomentFailed"), { variant: "error" });
    }
  }, [
    consoleApi,
    urlState,
    event,
    onClose,
    refreshEvents,
    setTask,
    record.value,
    enqueueSnackbar,
    t,
  ]);

  const onMetaDataKeyDown = useCallback(
    (keyboardEvent: React.KeyboardEvent) => {
      if (keyboardEvent.key === "Enter") {
        createMomentBtnRef.current?.click();
      }
    },
    [createMomentBtnRef],
  );

  const invokeTabKey = () => {
    // get the active element when Enter was pressed and
    // if it is an input, focus the next input
    // NOTE: You cannot really trigger the browser event -
    //       even if you do, the browser won't execute the action
    //       (such as focusing the next input) so you have to define the action
    let currInput = document.activeElement;
    if (currInput?.tagName.toLowerCase() === "input") {
      const inputs = document.getElementsByTagName("input");
      currInput = document.activeElement;
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i] === currInput) {
          const next = inputs[i + 1];
          if (next?.focus) {
            next.focus();
          }
          break;
        }
      }
    }
  };

  const addRow = useCallback(
    (index: number) => {
      setEvent((draft) => {
        draft.metadataEntries.splice(index + 1, 0, { key: "", value: "" });
      });
    },
    [setEvent],
  );

  const removeRow = useCallback(
    (index: number) => {
      setEvent((draft) => {
        if (draft.metadataEntries.length > 1) {
          draft.metadataEntries.splice(index, 1);
        }
      });
    },
    [setEvent],
  );

  const formattedStartTime = currentTime ? formatTime(currentTime) : "-";

  const [createEventDialogOpen, setCreateEventDialogOpen] = useState(true);

  return (
    <>
      {createEventDialogOpen && (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
          <Stack paddingX={3} paddingTop={2}>
            <Typography variant="h2">{t("createMoment")}</Typography>
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <TextField
              id="event-name"
              label={
                <>
                  <span className={classes.requiredFlags}>*</span>
                  {t("name")}
                </>
              }
              maxRows={1}
              value={isDemoSite ? "机器人不动" : event.eventName}
              onChange={(val) => {
                // µ = option + M 是 mac 打开弹窗的快捷键
                if (val.target.value !== "µ") {
                  setEvent((old) => ({ ...old, eventName: val.target.value }));
                }
              }}
              fullWidth
              variant="standard"
              autoFocus
              onKeyDown={onMetaDataKeyDown}
            />
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <div className={classes.grid}>
              <FormControl>
                <FormLabel>{t("startTime")}</FormLabel>
                <Typography paddingY={1}>{formattedStartTime}</Typography>
              </FormControl>
              <TextField
                value={event.duration ?? ""}
                fullWidth
                label={t("duration")}
                onChange={(ev) => {
                  const duration = Number(ev.currentTarget.value);
                  setEvent((oldEvent) => ({
                    ...oldEvent,
                    duration: duration > 0 ? duration : undefined,
                  }));
                }}
                type="number"
                InputProps={{
                  endAdornment: (
                    <ToggleButtonGroup
                      className={classes.toggleButtonGroup}
                      size="small"
                      exclusive
                      value={event.durationUnit}
                      onChange={(_ev, durationUnit) => {
                        if (event.durationUnit !== durationUnit) {
                          setEvent((old) => ({ ...old, durationUnit }));
                        }
                      }}
                    >
                      <div className={classes.toggleButton} tabIndex={-1}>
                        {t("sec")}
                      </div>
                    </ToggleButtonGroup>
                  ),
                }}
              />
              <ButtonGroup style={{ visibility: "hidden" }}>
                <IconButton tabIndex={-1} data-testid="add">
                  <AddIcon />
                </IconButton>
                <IconButton tabIndex={-1}>
                  <AddIcon />
                </IconButton>
              </ButtonGroup>
            </div>
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <div>
              <TextField
                id="description"
                label={t("description")}
                rows={2}
                value={isDemoSite ? "机器人在原地无法移动" : event.description}
                onChange={(val) => {
                  setEvent((old) => ({ ...old, description: val.target.value }));
                }}
                fullWidth
                variant="standard"
                onKeyDown={onMetaDataKeyDown}
              />
            </div>
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <FormLabel>{t("metadata")}</FormLabel>
            <div className={classes.grid}>
              {event.metadataEntries.map(({ key, value }, index) => {
                const hasDuplicate = +((key.length > 0 && countedMetadata[key]) ?? 0) > 1;
                return (
                  <div className={classes.row} key={index}>
                    <TextField
                      fullWidth
                      value={key}
                      placeholder={`${t("key")} (${t("string")})`}
                      error={hasDuplicate}
                      onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                        if (keyboardEvent.key === "Enter") {
                          invokeTabKey();
                        }
                      }}
                      onChange={(evt) => {
                        updateMetadata(index, "key", evt.currentTarget.value);
                      }}
                    />
                    <TextField
                      fullWidth
                      value={value}
                      placeholder={`${t("value")} (${t("string")})`}
                      error={hasDuplicate}
                      onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                        if (
                          (keyboardEvent.nativeEvent.target as HTMLInputElement).value !== "" &&
                          keyboardEvent.key === "Enter"
                        ) {
                          onMetaDataKeyDown(keyboardEvent);
                        }
                      }}
                      onChange={(evt) => {
                        updateMetadata(index, "value", evt.currentTarget.value);
                      }}
                    />
                    <ButtonGroup>
                      <IconButton
                        tabIndex={-1}
                        onClick={() => {
                          addRow(index);
                        }}
                      >
                        <AddIcon />
                      </IconButton>
                      <IconButton
                        tabIndex={-1}
                        onClick={() => {
                          removeRow(index);
                        }}
                        style={{
                          visibility: event.metadataEntries.length > 1 ? "visible" : "hidden",
                        }}
                      >
                        <RemoveIcon />
                      </IconButton>
                    </ButtonGroup>
                  </div>
                );
              })}
            </div>
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <FormControlLabel
              disableTypography
              checked={event.enabledCreateNewTask}
              control={
                <Checkbox
                  size="medium"
                  checked={isDemoSite ? true : event.enabledCreateNewTask}
                  onChange={() => {
                    setEvent((old) => ({
                      ...old,
                      enabledCreateNewTask: !old.enabledCreateNewTask,
                    }));
                  }}
                />
              }
              label={t("createNewTask")}
            />
          </Stack>
          <DialogActions>
            <Button variant="outlined" size="large" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              variant="contained"
              size="large"
              id="create-moment"
              onClick={async () => {
                if (!isDemoSite) {
                  await createEvent();
                  setCreateEventDialogOpen(false);
                } else {
                  setTask({
                    enabled: true,
                    eventName: "demo",
                    title: "机器人不动",
                    description: "麻烦看一下这个问题，并给出解决方案",
                  });
                  setTimeout(() => {
                    window.nextStep();
                    setCreateEventDialogOpen(false);
                  }, 100);
                }
              }}
              disabled={isDemoSite ? false : !canSubmit || createdEvent.loading || !event.eventName}
              ref={createMomentBtnRef}
            >
              {createdEvent.loading && (
                <CircularProgress color="inherit" size="1rem" style={{ marginRight: "0.5rem" }} />
              )}
              {t("createMoment")}
            </Button>
          </DialogActions>
          {duplicateKey && <Alert severity="error">Duplicate key {duplicateKey[0]}</Alert>}
          {createdEvent.error?.message && (
            <Alert severity="error">{createdEvent.error.message}</Alert>
          )}
        </Dialog>
      )}
      {task.enabled && targetEvent && (
        <CreateTaskDialog
          initialTask={{
            title: task.title,
            eventName: task.eventName,
            description: task.description,
          }}
          onClose={() => {
            setTask({ enabled: false, eventName: "", title: "", description: "" });
            onClose();
          }}
          event={targetEvent}
        />
      )}
    </>
  );
}
