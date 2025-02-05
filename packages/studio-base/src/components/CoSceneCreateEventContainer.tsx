// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Timestamp, FieldMask } from "@bufbuild/protobuf";
import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import EastIcon from "@mui/icons-material/East";
import HelpIcon from "@mui/icons-material/Help";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
  Typography,
  FormLabel,
  FormControl,
  IconButton,
  ButtonGroup,
  Select,
  MenuItem,
  Tooltip,
  Autocomplete,
  Link,
} from "@mui/material";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import PinyinMatch from "pinyin-match";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn, useAsync } from "react-use";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";
import { useImmer } from "use-immer";
import { v4 as uuidv4 } from "uuid";

import {
  toDate,
  isLessThan,
  subtract,
  toSec,
  isGreaterThan,
  add,
  fromSec,
  fromDate,
} from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  BagFileInfo,
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { EventsStore, useEvents, KeyValue } from "@foxglove/studio-base/context/EventsContext";
import { useAppConfigurationValue, useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import { secondsToDuration } from "@foxglove/studio-base/util/time";

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
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
  addFileButton: {
    display: "flex",
    gap: theme.spacing(0.5),
    whiteSpace: "nowrap",
  },
  containerFooter: {
    display: "flex",
    justifyContent: "end",
    gap: "8px",
    padding: "24px",
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    marginRight: 5,
  },
}));

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

const PIVOT_METRIC = "pivotMetric";
const temperature = [...new Array(9).keys()].map((i) => `温度0${i + 1}`);
const pivotMetricValues = ["General", "功率", "压力", "转速", "风速", ...temperature, "温度10"];

function CreateTaskSuccessToast({ targetUrl }: { targetUrl: string }): React.ReactNode {
  const { t } = useTranslation("cosEvent");

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Typography>{t("createTaskSuccess")}</Typography>
      <Link href={targetUrl} target="_blank" underline="hover" color="inherit">
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("toView")}
          <EastIcon />
        </Stack>
      </Link>
    </Stack>
  );
}

export function CoSceneCreateEventContainer(props: { onClose: () => void }): React.JSX.Element {
  const { onClose } = props;

  const [timeModeSetting] = useAppConfigurationValue<string>(AppSetting.TIME_MODE);
  const timeMode = timeModeSetting === "relativeTime" ? "relativeTime" : "absoluteTime";

  const refreshEvents = useEvents(selectRefreshEvents);
  const toModifyEvent = useEvents(selectToModifyEvent);

  const [isComposition, setIsComposition] = useState(false);

  const isEditing = toModifyEvent != undefined;

  const eventMarks = useEvents(selectEventMarks);

  const markStartTime = eventMarks[0]?.time;
  const markEndTime = eventMarks[1]?.time;

  const { t } = useTranslation("cosEvent");
  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);
  const bagFiles = usePlaylist(selectBagFiles);

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const passingFile = bagFiles.value?.filter((bag) => {
    if (bag.startTime == undefined || bag.endTime == undefined) {
      return false;
    }
    const bagStartTime = timeMode === "absoluteTime" ? bag.startTime : { sec: 0, nsec: 0 };
    const bagEndTime =
      timeMode === "absoluteTime" ? bag.endTime : subtract(bag.endTime, bag.startTime);

    return (
      bag.fileType !== "GHOST_RESULT_FILE" &&
      markStartTime &&
      !isGreaterThan(bagStartTime, markStartTime) &&
      !isLessThan(bagEndTime, markStartTime)
    );
  });

  const recordItems = useMemo(() => {
    const tempRecordItems: BagFileInfo[] = [];
    passingFile?.forEach((ele) => {
      if (
        tempRecordItems.find((item) => ele.recordDisplayName === item.recordDisplayName) ==
        undefined
      ) {
        tempRecordItems.push(ele);
      }
    });
    return tempRecordItems;
  }, [passingFile]);

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
    // if is create new momnet, fileName is the target bag file name
    // if is edit moment, fileName is the target record name
    fileName: string;
    imageFile?: File;
    imgUrl?: string;
    record: string;
  }>({
    eventName: "",
    startTime: markStartTime ? toDate(markStartTime) : undefined,
    duration: 1,
    durationUnit: "sec",
    description: "",
    metadataEntries: [{ key: "", value: "" }],
    enabledCreateNewTask: false,
    fileName: passingFile?.[0]?.name ?? "",
    record: "",
  });

  const [task, setTask] = useImmer<{
    title: string;
    description: string;
    assignee: string;
    assigner: string;
    needSyncTask: boolean;
  }>({
    title: "",
    description: "",
    assignee: "",
    assigner: "",
    needSyncTask: false,
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
        fileName: toModifyEvent.record,
        imgUrl: toModifyEvent.imgUrl,
        record: toModifyEvent.record,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentFile = useMemo(() => {
    return passingFile?.find((bag) => bag.name === event.fileName);
  }, [passingFile, event.fileName]);

  useEffect(() => {
    setEvent((old) => {
      return {
        ...old,
        startTime: markStartTime
          ? timeMode === "relativeTime"
            ? toDate(add(markStartTime, currentFile?.startTime ?? { sec: 0, nsec: 0 }))
            : toDate(markStartTime)
          : undefined,
        duration: markEndTime && markStartTime ? toSec(subtract(markEndTime, markStartTime)) : 0,
      };
    });
  }, [currentFile?.startTime, markEndTime, setEvent, timeMode, markStartTime, isEditing]);

  useEffect(() => {
    if ((passingFile == undefined || passingFile.length === 0) && !isEditing) {
      onClose();
      toast.error(t("creationUnavailableInCurrentPeriod"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.addEventListener("compositionstart", () => {
      setIsComposition(true);
    });
    document.addEventListener("compositionend", () => {
      setIsComposition(false);
    });

    return () => {
      document.removeEventListener("compositionstart", () => {
        setIsComposition(true);
      });
      document.removeEventListener("compositionend", () => {
        setIsComposition(false);
      });
    };
  }, []);

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

  const onMetaDataKeyDown = useCallback(
    (keyboardEvent: React.KeyboardEvent) => {
      if (keyboardEvent.key === "Enter" && !isComposition) {
        createMomentBtnRef.current?.click();
      }
    },
    [createMomentBtnRef, isComposition],
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

  const formattedEventStartTime = event.startTime ? formatTime(fromDate(event.startTime)) : "-";
  const formattedEventEndTime = event.startTime
    ? formatTime(add(fromDate(event.startTime), fromSec(event.duration ?? 0)))
    : "-";

  const inputRef = useRef<HTMLInputElement>(ReactNull);

  const isSupor = getDomainConfig().logo === "supor";

  // about task ---------------------
  const projectName = event.fileName.split("/records/")[0];
  const recordName = event.fileName.split("/files/")[0];

  const { value: users } = useAsync(async () => {
    return await consoleApi.listOrganizationUsers();
  });

  const { value: syncedTask } = useAsync(async () => {
    const parent = `${projectName}/ticketSystem`;
    return await consoleApi.getTicketSystemMetadata({ parent });
  });

  const activatedUsers = users?.filter((user) => user.active);

  const jiraEnabled = syncedTask?.jiraEnabled;
  const onesEnabled = syncedTask?.onesEnabled;

  const [, syncTask] = useAsyncFn(async (name: string) => {
    try {
      await consoleApi.syncTask({ name });
      enqueueSnackbar(t("syncTaskSuccess"), { variant: "success" });
    } catch {
      enqueueSnackbar(t("syncTaskFailed"), { variant: "error" });
    }
  });

  const [createdTask, createTask] = useAsyncFn(
    async ({ targetEvent }: { targetEvent: Event }) => {
      const parent = projectName;

      if (parent == undefined) {
        toast.error("createTaskFailed");
        return;
      }

      const description =
        JSON.stringify({
          root: {
            children: [
              {
                children: [
                  {
                    sourceName: targetEvent.name,
                    sourceType: "moment",
                    type: "source",
                    version: 1,
                  },
                ],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
              },
              ...task.description.split("\n").map((text) => ({
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: "normal",
                    style: "",
                    text,
                    type: "text",
                    version: 1,
                  },
                ],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
              })),
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "root",
            version: 1,
          },
        }) ?? task.description;
      try {
        const newTask = await consoleApi.createTask({
          parent,
          task: { ...task, description },
          event: targetEvent,
        });
        const targetUrl = `${window.location.origin}/${baseInfo.organizationSlug}/${
          baseInfo.projectSlug
        }/tasks/general-tasks/${newTask.name.split("/").pop()}`;

        enqueueSnackbar(<CreateTaskSuccessToast targetUrl={targetUrl} />, {
          variant: "success",
        });
        if (task.needSyncTask) {
          await syncTask(newTask.name);
        }
        onClose();
      } catch {
        enqueueSnackbar(t("createTaskFailed"), { variant: "error" });
      }
    },
    [
      baseInfo.organizationSlug,
      baseInfo.projectSlug,
      consoleApi,
      enqueueSnackbar,
      onClose,
      projectName,
      syncTask,
      t,
      task,
    ],
  );

  // create moment ---------------------
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

    const newEvent = new Event();

    newEvent.displayName = event.eventName;
    const timestamp = Timestamp.fromDate(event.startTime);

    newEvent.triggerTime = timestamp;

    if (event.durationUnit === "sec") {
      newEvent.duration = secondsToDuration(event.duration);
    } else {
      newEvent.duration = secondsToDuration(event.duration / 1e9);
    }

    if (event.description) {
      newEvent.description = event.description;
    }

    Object.keys(keyedMetadata).forEach((key) => {
      newEvent.customizedFields[key] = keyedMetadata[key] ?? "";
    });

    if (projectName == undefined || recordName == undefined) {
      toast.error(t("createMomentFailed"));
      return;
    }

    try {
      if (event.imageFile) {
        const imgId = uuidv4();

        const imgFileDisplayName = `${imgId}.${
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/strict-boolean-expressions
          ((event.imageFile as any).path || event.imageFile.name).split(".").pop()
        }`;

        await consoleApi.uploadEventPicture({
          recordName,
          file: event.imageFile,
          filename: imgFileDisplayName,
        });

        newEvent.files = [`${recordName}/files/.cos/moments/${imgFileDisplayName}`];
      }

      const result = await consoleApi.createEvent({
        event: newEvent,
        parent: projectName,
        recordName,
      });

      if (event.enabledCreateNewTask) {
        await createTask({ targetEvent: result });
      } else {
        onClose();
      }

      refreshEvents();
      enqueueSnackbar(t("createMomentSuccess"), { variant: "success" });
    } catch {
      enqueueSnackbar(t("createMomentFailed"), { variant: "error" });
    }
  }, [
    event.startTime,
    event.duration,
    event.metadataEntries,
    event.eventName,
    event.durationUnit,
    event.description,
    event.imageFile,
    event.enabledCreateNewTask,
    projectName,
    recordName,
    t,
    consoleApi,
    refreshEvents,
    enqueueSnackbar,
    createTask,
    onClose,
  ]);

  // edit moment ---------------------
  const [editedEvent, editEvent] = useAsyncFn(async () => {
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

    newEvent.name = toModifyEvent?.name ?? "";

    newEvent.displayName = event.eventName;
    const timestamp = Timestamp.fromDate(event.startTime);

    newEvent.triggerTime = timestamp;

    if (event.durationUnit === "sec") {
      newEvent.duration = secondsToDuration(event.duration);
    } else {
      newEvent.duration = secondsToDuration(event.duration / 1e9);
    }

    if (event.description) {
      newEvent.description = event.description;
    }

    const maskArray = [
      "displayName",
      "duration_nanos",
      "description",
      "duration",
      "customizedFields",
    ];

    if (!event.imgUrl && !event.imageFile) {
      newEvent.files = [];
      maskArray.push("files");
    }

    Object.keys(keyedMetadata).forEach((key) => {
      newEvent.customizedFields[key] = keyedMetadata[key] ?? "";
    });

    try {
      const imgId = uuidv4();

      if (event.imageFile && recordName) {
        const imgFileDisplayName = `${imgId}.${
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/strict-boolean-expressions
          ((event.imageFile as any).path || event.imageFile.name).split(".").pop()
        }`;

        await consoleApi.uploadEventPicture({
          recordName,
          file: event.imageFile,
          filename: imgFileDisplayName,
        });

        newEvent.files = [`${recordName}/files/.cos/moments/${imgFileDisplayName}`];
        maskArray.push("files");
      }

      const fieldMask = new FieldMask();
      fieldMask.paths = maskArray;

      await consoleApi.updateEvent({
        event: newEvent,
        updateMask: fieldMask,
      });
      onClose();

      refreshEvents();
      enqueueSnackbar(t("editMomentSuccess"), { variant: "success" });
    } catch {
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
    event.imgUrl,
    event.metadataEntries,
    event.startTime,
    onClose,
    recordName,
    refreshEvents,
    t,
    toModifyEvent?.name,
  ]);

  return (
    <>
      <Stack>
        <Stack paddingX={3} paddingTop={2}>
          <Typography variant="h4">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
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
            value={event.eventName}
            onChange={(val) => {
              setEvent((old) => ({ ...old, eventName: val.target.value }));
            }}
            variant="outlined"
            autoFocus
            onKeyDown={onMetaDataKeyDown}
          />
        </Stack>
        <Stack paddingX={3} paddingTop={2}>
          <FormControl>
            <FormLabel>{t("startAndEndTime")}</FormLabel>
            <Typography paddingY={1}>
              <Stack alignItems="center" direction="row" gap={1}>
                {t("startAndEndTimeDesc", {
                  startTime: formattedEventStartTime,
                  endTime: formattedEventEndTime,
                })}
                {event.duration?.toFixed(3) ?? ""}
                {t("seconds")}
              </Stack>
            </Typography>
          </FormControl>
        </Stack>
        <Stack paddingX={3} paddingTop={2}>
          <TextField
            id="description"
            label={t("description")}
            rows={2}
            value={event.description}
            onChange={(val) => {
              setEvent((old) => ({ ...old, description: val.target.value }));
            }}
            onKeyDown={onMetaDataKeyDown}
            variant="outlined"
          />
        </Stack>
        <Stack paddingX={3} paddingTop={2}>
          <FormLabel>{t("photo")}</FormLabel>
          {event.imageFile ? (
            <Stack>
              <img
                onClick={() => inputRef.current?.click()}
                src={URL.createObjectURL(event.imageFile)}
                style={{
                  maxHeight: "200px",
                  objectFit: "contain",
                }}
              />
            </Stack>
          ) : (
            event.imgUrl && (
              <Stack>
                <img
                  onClick={() => inputRef.current?.click()}
                  src={event.imgUrl}
                  style={{
                    maxHeight: "200px",
                    objectFit: "contain",
                  }}
                />
              </Stack>
            )
          )}

          {event.imgUrl ? (
            <Button
              className={classes.addFileButton}
              onClick={() => {
                setEvent((old) => ({ ...old, imgUrl: undefined, imageFile: undefined }));
              }}
            >
              <DeleteForeverIcon />
              {t("delete", {
                ns: "cosGeneral",
              })}
            </Button>
          ) : (
            <Button className={classes.addFileButton} onClick={() => inputRef.current?.click()}>
              <AddIcon />
              {t("addPhoto")}
            </Button>
          )}
          <input
            hidden
            ref={inputRef}
            type="file"
            accept="image/*"
            value=""
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) {
                return;
              }
              setEvent((val) => ({ ...val, imgUrl: undefined, imageFile: file }));
            }}
          />
        </Stack>
        <Stack paddingX={3} paddingTop={2}>
          <FormLabel>{t("attribute")}</FormLabel>
          <div className={classes.grid}>
            {isSupor ? (
              <div className={classes.row}>
                <div>
                  {PIVOT_METRIC}{" "}
                  <Tooltip placement="top-start" title={t("pivotMetricTooltip")}>
                    <IconButton>
                      <HelpIcon />
                    </IconButton>
                  </Tooltip>
                </div>
                <Select
                  value={
                    event.metadataEntries.find((entry) => entry.key === PIVOT_METRIC)?.value ?? ""
                  }
                  onChange={(evt) => {
                    setEvent((old) => {
                      const metadataEntries = old.metadataEntries;
                      const metadataEntry = metadataEntries.find(
                        (entry) => entry.key === PIVOT_METRIC,
                      );
                      if (metadataEntry) {
                        metadataEntry.value = evt.target.value;
                      } else {
                        metadataEntries.unshift({ key: PIVOT_METRIC, value: evt.target.value });
                      }
                    });
                  }}
                >
                  {pivotMetricValues.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
                <div>
                  {event.metadataEntries.find((entry) => entry.key === PIVOT_METRIC)?.value && (
                    <IconButton
                      onClick={() => {
                        setEvent((old) => {
                          return {
                            ...old,
                            metadataEntries: old.metadataEntries.filter(
                              (entry) => entry.key !== PIVOT_METRIC,
                            ),
                          };
                        });
                      }}
                    >
                      <ClearIcon />
                    </IconButton>
                  )}
                </div>
              </div>
            ) : (
              event.metadataEntries.map(({ key, value }, index) => {
                const hasDuplicate = +((key.length > 0 && countedMetadata[key]) ?? 0) > 1;
                return (
                  <div className={classes.row} key={index}>
                    <TextField
                      value={key}
                      placeholder={t("attributeKey")}
                      error={hasDuplicate}
                      onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                        if (keyboardEvent.key === "Enter" && !isComposition) {
                          invokeTabKey();
                        }
                      }}
                      onChange={(evt) => {
                        updateMetadata(index, "key", evt.currentTarget.value);
                      }}
                    />
                    <TextField
                      value={value}
                      placeholder={t("attributeValue")}
                      error={hasDuplicate}
                      onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                        if (
                          (keyboardEvent.nativeEvent.target as HTMLInputElement).value !== "" &&
                          keyboardEvent.key === "Enter" &&
                          !isComposition
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
              })
            )}
          </div>
        </Stack>
        {!isEditing && (
          <Stack paddingX={3} paddingTop={2}>
            <FormLabel>{t("record")}</FormLabel>
            <Select
              value={recordItems[0]?.name ?? ""}
              disabled={recordItems.length <= 1}
              onChange={(e) => {
                setEvent((old) => ({ ...old, fileName: e.target.value }));
              }}
            >
              {recordItems.map((bag) => (
                <MenuItem key={bag.name} value={bag.name}>
                  {bag.recordDisplayName}
                </MenuItem>
              ))}
            </Select>
          </Stack>
        )}
        {!isEditing && (
          <Stack paddingX={3} paddingTop={2}>
            <FormControlLabel
              disableTypography
              checked={event.enabledCreateNewTask}
              control={
                <Checkbox
                  size="medium"
                  checked={event.enabledCreateNewTask}
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
        {event.enabledCreateNewTask && (
          <>
            <Stack paddingX={3} paddingTop={2}>
              <TextField
                fullWidth
                variant="outlined"
                label={
                  <>
                    <span className={classes.requiredFlags}>*</span>
                    {t("taskName")}
                  </>
                }
                maxRows={1}
                value={task.title}
                onChange={(val) => {
                  setTask((state) => ({ ...state, title: val.target.value }));
                }}
                onKeyDown={onMetaDataKeyDown}
              />
            </Stack>
            <Stack paddingX={3} paddingTop={2}>
              <TextField
                id="description"
                label={t("taskDescription")}
                rows={3}
                value={task.description}
                onChange={(val) => {
                  setTask((state) => ({ ...state, description: val.target.value }));
                }}
                fullWidth
                variant="outlined"
                onKeyDown={onMetaDataKeyDown}
              />
            </Stack>
            <Stack paddingX={3} paddingTop={2}>
              <FormControl>
                <FormLabel>{t("taskAssignee")}</FormLabel>
                <Autocomplete
                  disableClearable
                  options={activatedUsers ?? []}
                  getOptionLabel={(option) => option.nickname ?? ""}
                  renderInput={(params) => <TextField {...params} autoFocus variant="outlined" />}
                  renderOption={(optionProps, option) => (
                    <Box component="li" {...optionProps} key={option.name}>
                      <img className={classes.avatar} src={option.avatar} />
                      {option.nickname}
                    </Box>
                  )}
                  value={activatedUsers?.find((user) => user.name === task.assignee)}
                  isOptionEqualToValue={(option, value) => option.name === value.name}
                  onChange={(_event, option) => {
                    setTask((s) => ({ ...s, assignee: option.name }));
                  }}
                  filterOptions={(options, { inputValue }) => {
                    if (!inputValue) {
                      return options;
                    }
                    return options.filter((option) => {
                      const pinyinMatch = PinyinMatch.match(option.nickname ?? "", inputValue);
                      return (option.nickname ?? "").includes(inputValue) || pinyinMatch !== false;
                    });
                  }}
                  onKeyDown={onMetaDataKeyDown}
                />
              </FormControl>
            </Stack>
            <Stack paddingX={3} paddingTop={2}>
              {!(jiraEnabled ?? false) && !(onesEnabled ?? false) ? (
                <Tooltip title={t("syncTaskTooltip")} placement="top-start">
                  <FormControlLabel
                    disableTypography
                    checked={task.needSyncTask}
                    control={
                      <Checkbox
                        size="medium"
                        checked={task.needSyncTask}
                        onChange={(e) => {
                          setTask((state) => ({ ...state, needSyncTask: e.target.checked }));
                        }}
                        disabled={true}
                      />
                    }
                    label={t("syncTask")}
                  />
                </Tooltip>
              ) : (
                <FormControlLabel
                  disableTypography
                  checked={task.needSyncTask}
                  control={
                    <Checkbox
                      size="medium"
                      checked={task.needSyncTask}
                      onChange={(e) => {
                        setTask((state) => ({ ...state, needSyncTask: e.target.checked }));
                      }}
                    />
                  }
                  label={t("syncTask")}
                />
              )}
            </Stack>
          </>
        )}
        <div className={classes.containerFooter}>
          <Button variant="outlined" size="large" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            size="large"
            id="create-moment"
            onClick={async () => {
              if (isEditing) {
                await editEvent();
              } else {
                await createEvent();
              }
            }}
            disabled={
              !canSubmit ||
              createdEvent.loading ||
              editedEvent.loading ||
              !event.eventName ||
              (event.enabledCreateNewTask && task.title === "")
            }
            ref={createMomentBtnRef}
          >
            {(createdEvent.loading || editedEvent.loading || createdTask.loading) && (
              <CircularProgress color="inherit" size="1rem" style={{ marginRight: "0.5rem" }} />
            )}
            {isEditing ? t("edit") : t("createMoment")}
          </Button>
        </div>
        {duplicateKey && (
          <Alert severity="error">
            {t("duplicateKey")} {duplicateKey[0]}
          </Alert>
        )}
        {createdEvent.error?.message && (
          <Alert severity="error">{createdEvent.error.message}</Alert>
        )}
      </Stack>
    </>
  );
}
