// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/file_pb";
import AddIcon from "@mui/icons-material/Add";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
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
  Select,
  MenuItem,
} from "@mui/material";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";
import { Timestamp } from "google-protobuf/google/protobuf/timestamp_pb";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";
import { useImmer } from "use-immer";

import { toDate, isLessThan, subtract, isGreaterThan, add } from "@foxglove/rostime";
import CoSceneChooser from "@foxglove/studio-base/components/CoSceneChooser";
import { CreateTaskDialog } from "@foxglove/studio-base/components/CreateTaskDialog";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";

export type ToModifyEvent = {
  name: string;
  eventName: string;
  startTime: undefined | Date;
  duration: undefined | number;
  durationUnit: "sec" | "nsec";
  description: undefined | string;
  metadataEntries: KeyValue[];
  enabledCreateNewTask: boolean;
  fileName: string;
  imageFile?: File;
};

const fadeInAnimation = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const useStyles = makeStyles()((theme, _params) => ({
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
  toggleButtonGroup: {
    marginRight: theme.spacing(-1),
    gap: theme.spacing(0.25),
  },
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
  addFileButton: {
    display: "flex",
    gap: theme.spacing(0.5),
    whiteSpace: "nowrap",
  },
}));

type KeyValue = { key: string; value: string };

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;

export function CreateEventDialog(props: {
  onClose: () => void;
  toModifyEvent?: ToModifyEvent;
}): JSX.Element {
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" &&
    localStorage.getItem("honeybeeDemoStatus") === "start";

  const { onClose, toModifyEvent } = props;

  const isEditing = toModifyEvent != undefined;

  const refreshEvents = useEvents(selectRefreshEvents);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [imageUrl, setImageUrl] = useState<string>("");

  const { t } = useTranslation("cosEvent");
  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);
  const bagFiles = usePlaylist(selectBagFiles);
  const timeMode = useMemo(() => {
    return localStorage.getItem("CoScene_timeMode") === "relativeTime"
      ? "relativeTime"
      : "absoluteTime";
  }, []);
  const [addPhotoDialogOpen, setAddPhotoDialogOpen] = useState<boolean>(false);

  const passingFile = bagFiles.value?.filter((bag) => {
    if (bag.startTime == undefined || bag.endTime == undefined) {
      return false;
    }
    const bagStartTime = timeMode === "absoluteTime" ? bag.startTime : { sec: 0, nsec: 0 };
    const bagEndTime =
      timeMode === "absoluteTime" ? bag.endTime : subtract(bag.endTime, bag.startTime);

    return (
      bag.fileType !== "GHOST_RESULT_FILE" &&
      currentTime &&
      isLessThan(bagStartTime, currentTime) &&
      isGreaterThan(bagEndTime, currentTime)
    );
  });

  const { classes } = useStyles();
  const consoleApi = useConsoleApi();

  const [event, setEvent] = useImmer<{
    eventName: string;
    startTime: undefined | Date;
    duration: undefined | number;
    durationUnit: "sec" | "nsec";
    description: undefined | string;
    metadataEntries: KeyValue[];
    enabledCreateNewTask: boolean;
    fileName: string;
    imageFile?: File;
  }>({
    eventName: "",
    startTime: currentTime ? toDate(currentTime) : undefined,
    duration: 1,
    durationUnit: "sec",
    description: "",
    metadataEntries: [{ key: "", value: "" }],
    enabledCreateNewTask: false,
    fileName: passingFile?.[0]?.name ?? "",
  });

  useEffect(() => {
    if (toModifyEvent != undefined) {
      setEvent((old) => ({
        ...old,
        eventName: toModifyEvent.eventName,
        startTime: toModifyEvent.startTime,
        duration: toModifyEvent.duration,
        durationUnit: toModifyEvent.durationUnit,
        description: toModifyEvent.description,
        metadataEntries:
          toModifyEvent.metadataEntries.length > 0
            ? toModifyEvent.metadataEntries
            : [{ key: "", value: "" }],
        enabledCreateNewTask: toModifyEvent.enabledCreateNewTask,
        fileName: toModifyEvent.fileName,
      }));
      if (toModifyEvent.fileName) {
        const imgFile = new File({
          name: toModifyEvent.fileName,
        });
        consoleApi
          .generateFileDownloadUrl(imgFile)
          .then((resp) => {
            const url = resp.preSignedUrl;

            setImageUrl(url);
          })
          .catch((e) => {
            console.error(e);
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentFile = useMemo(() => {
    return passingFile?.find((bag) => bag.name === event.fileName);
  }, [passingFile, event.fileName]);

  useEffect(() => {
    setEvent((old) => ({
      ...old,
      startTime: currentTime
        ? timeMode === "relativeTime"
          ? toDate(add(currentTime, currentFile?.startTime ?? { sec: 0, nsec: 0 }))
          : toDate(currentTime)
        : undefined,
    }));
  }, [currentFile?.startTime, currentTime, setEvent, timeMode]);

  useEffect(() => {
    if (passingFile == undefined || passingFile.length === 0) {
      onClose();
      toast.error(t("creationUnavailableInCurrentPeriod"));
    }
  }, [passingFile, onClose, t]);

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

    const fileName = event.fileName;

    const projectName = fileName.split("/records/")[0];

    const recordName = fileName.split("/revisions/")[0];

    const revisionId = fileName.split("/files/")[0];

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

    if (revisionId) {
      newEvent.setRevision(revisionId);
    }

    if (event.imageFile) {
      newEvent.setFilesList([event.imageFile.name]);
    }

    Object.keys(keyedMetadata).forEach((key) => {
      newEvent.getCustomizedFieldsMap().set(key, keyedMetadata[key] ?? "");
    });

    if (projectName == undefined || recordName == undefined) {
      toast.error(t("createMomentFailed"));
      return;
    }

    try {
      const result = await consoleApi.createEvent({
        event: newEvent,
        parent: projectName,
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
  }, [consoleApi, event, onClose, refreshEvents, setTask, enqueueSnackbar, t]);

  const [_editedEvent, editEvent] = useAsyncFn(async () => {
    if (event.startTime == undefined || event.duration == undefined) {
      return;
    }

    const filteredMeta = event.metadataEntries.filter(
      (entry) => entry.key.length > 0 && entry.value.length > 0,
    );
    const keyedMetadata = Object.fromEntries(
      filteredMeta.map((entry) => [entry.key.trim(), entry.value.trim()]),
    );

    const newEvent = new Event();

    newEvent.setName(toModifyEvent?.name ?? "");

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

    const maskArray = ["displayName", "description", "duration", "customizedFields"];

    if (event.imageFile) {
      newEvent.setFilesList([event.imageFile.name]);
      maskArray.push("files");
    }

    Object.keys(keyedMetadata).forEach((key) => {
      newEvent.getCustomizedFieldsMap().set(key, keyedMetadata[key] ?? "");
    });

    const fieldMask = new FieldMask();
    fieldMask.setPathsList(maskArray);

    try {
      await consoleApi.updateEvent({
        event: newEvent,
        updateMask: fieldMask,
      });

      onClose();

      refreshEvents();
      enqueueSnackbar(t("editMomentSuccess"), { variant: "success" });
    } catch (e) {
      enqueueSnackbar(t("editMomentFailed"), { variant: "error" });
    }
  }, [
    consoleApi,
    enqueueSnackbar,
    event.description,
    event.duration,
    event.durationUnit,
    event.eventName,
    event.imageFile,
    event.metadataEntries,
    event.startTime,
    onClose,
    refreshEvents,
    t,
    toModifyEvent?.name,
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

  let formattedStartTime = currentTime ? formatTime(currentTime) : "-";
  if (currentTime) {
    if (timeMode === "relativeTime") {
      formattedStartTime = formatTime(
        add(currentTime, currentFile?.startTime ?? { sec: 0, nsec: 0 }),
      );
    } else {
      formattedStartTime = formatTime(currentTime);
    }
  } else {
    formattedStartTime = "-";
  }

  const [createEventDialogOpen, setCreateEventDialogOpen] = useState(true);

  return (
    <>
      {createEventDialogOpen && (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
          <Stack paddingX={3} paddingTop={2}>
            <Typography variant="h2">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
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
              variant="outlined"
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
                      <Stack paddingX={1}>{t("sec")}</Stack>
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
            <TextField
              id="description"
              label={t("description")}
              rows={2}
              value={isDemoSite ? "机器人在原地无法移动" : event.description}
              onChange={(val) => {
                setEvent((old) => ({ ...old, description: val.target.value }));
              }}
              onKeyDown={onMetaDataKeyDown}
              variant="outlined"
            />
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <FormLabel>{t("photo")}</FormLabel>
            {imageUrl && (
              <Stack>
                <img
                  src={imageUrl}
                  style={{
                    maxHeight: "200px",
                    objectFit: "contain",
                  }}
                />
              </Stack>
            )}
            <Button
              className={classes.addFileButton}
              onClick={() => {
                if (imageUrl) {
                  setImageUrl("");
                  setEvent((old) => ({ ...old, imageFile: undefined }));
                } else {
                  setAddPhotoDialogOpen(true);
                }
              }}
            >
              {imageUrl ? (
                <>
                  <DeleteForeverIcon />
                  {t("delete", {
                    ns: "cosGeneral",
                  })}
                </>
              ) : (
                <>
                  <AddIcon />
                  {t("addPhoto")}
                </>
              )}
            </Button>
          </Stack>
          <Stack paddingX={3} paddingTop={2}>
            <FormLabel>{t("metadata")}</FormLabel>
            <div className={classes.grid}>
              {event.metadataEntries.map(({ key, value }, index) => {
                const hasDuplicate = +((key.length > 0 && countedMetadata[key]) ?? 0) > 1;
                return (
                  <div className={classes.row} key={index}>
                    <TextField
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
          {!isEditing && (
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
          )}
          {!isEditing && (
            <Stack paddingX={3} paddingTop={2}>
              <FormLabel>{t("record")}</FormLabel>
              <Select
                value={event.fileName}
                disabled={passingFile == undefined || passingFile.length <= 1}
                onChange={(e) => {
                  setEvent((old) => ({ ...old, fileName: e.target.value }));
                }}
              >
                {(passingFile ?? []).map((bag) => (
                  <MenuItem key={bag.name} value={bag.name}>
                    {bag.recordDisplayName}
                  </MenuItem>
                ))}
              </Select>
            </Stack>
          )}
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
                  if (isEditing) {
                    await editEvent();
                  } else {
                    await createEvent();
                  }
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
              {isEditing ? t("edit") : t("createMoment")}
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
          fileName={event.fileName}
        />
      )}
      <CoSceneChooser
        open={addPhotoDialogOpen}
        closeDialog={() => {
          setAddPhotoDialogOpen(false);
        }}
        onConfirm={async (files) => {
          const file = files[0];
          if (file == undefined) {
            return;
          }
          const resp = await consoleApi.generateFileDownloadUrl(file.file);

          const url = `${
            resp.preSignedUrl
          }&response-content-disposition=attachment%3B%20filename%3D${encodeURIComponent(
            file.file.filename,
          )}`;
          setImageUrl(url);
          setEvent((old) => ({ ...old, imageFile: file.file }));
        }}
        type="files"
        checkFileSupportedFunc={(file) => {
          return file.mediaType.startsWith("image");
        }}
        maxFilesNumber={1}
      />
    </>
  );
}
