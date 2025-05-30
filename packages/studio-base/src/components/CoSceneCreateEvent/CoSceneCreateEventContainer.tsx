// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Typography,
} from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn, useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";
import { useImmer } from "use-immer";

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
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useAppConfigurationValue, useAppTimeFormat } from "@foxglove/studio-base/hooks";

import { EventForm } from "./EventForm";
import { TaskForm } from "./TaskForm";
import { useEventOperations } from "./hooks/useEventOperations";
import { useTaskOperations } from "./hooks/useTaskOperations";
import { EventFormData, TaskFormData, ToModifyEvent } from "./types";
import { checkRequiredCustomFieldsFilled } from "./utils";

const useStyles = makeStyles()(() => ({
  containerFooter: {
    display: "flex",
    justifyContent: "end",
    gap: "8px",
    padding: "24px",
  },
}));

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectCustomFieldSchema = (store: EventsStore) => store.customFieldSchema;

export function CoSceneCreateEventContainer(props: { onClose: () => void }): React.JSX.Element {
  const { onClose } = props;

  const consoleApi = useConsoleApi();

  const [timeModeSetting] = useAppConfigurationValue<string>(AppSetting.TIME_MODE);
  const timeMode = timeModeSetting === "relativeTime" ? "relativeTime" : "absoluteTime";

  const toModifyEvent = useEvents(selectToModifyEvent);
  const [isComposition, setIsComposition] = useState(false);

  const isEditing = toModifyEvent != undefined;

  const eventMarks = useEvents(selectEventMarks);
  const customFieldSchema = useEvents(selectCustomFieldSchema);

  const markStartTime = eventMarks[0]?.time;
  const markEndTime = eventMarks[1]?.time;

  const { t } = useTranslation("cosEvent");
  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);
  const bagFiles = usePlaylist(selectBagFiles);

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const [taskCustomFieldSchema, getTaskCustomFieldSchema] = useAsyncFn(async () => {
    if (!baseInfo.warehouseId || !baseInfo.projectId) {
      return;
    }

    return await consoleApi.getTaskCustomFieldSchema(
      `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}`,
    );
  }, [consoleApi, baseInfo.warehouseId, baseInfo.projectId]);

  useEffect(() => {
    if (baseInfo.warehouseId && baseInfo.projectId) {
      getTaskCustomFieldSchema().catch((error: unknown) => {
        console.error(error);
      });
    }
  }, [baseInfo.warehouseId, baseInfo.projectId, getTaskCustomFieldSchema]);

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

  const [event, setEvent] = useImmer<EventFormData>({
    eventName: "",
    startTime: markStartTime ? toDate(markStartTime) : undefined,
    duration: 1,
    durationUnit: "sec",
    description: "",
    metadataEntries: [{ key: "", value: "" }],
    enabledCreateNewTask: false,
    fileName: passingFile?.[0]?.name ?? "",
    record: "",
    customFieldValues: undefined,
  });

  const [task, setTask] = useImmer<TaskFormData>({
    title: "",
    description: "",
    assignee: "",
    assigner: "",
    needSyncTask: false,
    customFieldValues: [],
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
        customFieldValues: toModifyEvent.customFieldValues,
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

  const { formatTime } = useAppTimeFormat();

  const countedMetadata = _.countBy(event.metadataEntries, (kv) => kv.key);
  const duplicateKey = Object.entries(countedMetadata).find(
    ([key, count]) => key.length > 0 && count > 1,
  );
  const canSubmit = event.startTime != undefined && event.duration != undefined && !duplicateKey;

  const onMetaDataKeyDown = useCallback(
    (keyboardEvent: React.KeyboardEvent) => {
      if (keyboardEvent.key === "Enter" && !isComposition) {
        createMomentBtnRef.current?.click();
      }
    },
    [createMomentBtnRef, isComposition],
  );

  const formattedEventStartTime = event.startTime ? formatTime(fromDate(event.startTime)) : "-";
  const formattedEventEndTime = event.startTime
    ? formatTime(add(fromDate(event.startTime), fromSec(event.duration ?? 0)))
    : "-";

  // about task ---------------------
  const projectName = event.fileName.split("/records/")[0];
  const recordName = event.fileName.split("/files/")[0];

  const { value: syncedTask } = useAsync(async () => {
    const parent = `${projectName}/ticketSystem`;
    return await consoleApi.getTicketSystemMetadata({ parent }).then((result) => ({
      ...result,
      enabled: result.jiraEnabled || result.onesEnabled || result.teambitionEnabled,
    }));
  });

  const [, syncTask] = useAsyncFn(async (name: string) => {
    try {
      await consoleApi.syncTask({ name });
      toast.success(t("syncTaskSuccess"));
    } catch {
      toast.error(t("syncTaskFailed"));
    }
  });

  // 检查必填自定义字段是否都已填写
  const isAllEventRequiredCustomFieldFilled = checkRequiredCustomFieldsFilled(
    customFieldSchema?.properties,
    event.customFieldValues,
  );

  const isAllTaskRequiredCustomFieldFilled = checkRequiredCustomFieldsFilled(
    taskCustomFieldSchema.value?.properties,
    task.customFieldValues,
  );

  // Task operations
  const { createdTask, createTask } = useTaskOperations({
    onClose,
    projectName,
    organizationSlug: baseInfo.organizationSlug,
    projectSlug: baseInfo.projectSlug,
    syncTask,
  });

  // Event operations
  const { createdEvent, createEvent, editedEvent, editEvent } = useEventOperations({
    onClose,
    projectName,
    recordName,
    toModifyEvent,
    createTask: async ({ targetEvent }) => {
      await createTask({ targetEvent, task });
    },
  });

  return (
    <>
      <Stack>
        <Stack paddingX={3} paddingTop={2}>
          <Typography variant="h4">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
        </Stack>

        <EventForm
          event={event}
          isEditing={isEditing}
          recordItems={recordItems}
          customFieldSchema={customFieldSchema}
          formattedEventStartTime={formattedEventStartTime}
          formattedEventEndTime={formattedEventEndTime}
          isComposition={isComposition}
          onEventChange={setEvent}
          onMetaDataKeyDown={onMetaDataKeyDown}
        />

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
          <TaskForm
            task={task}
            taskCustomFieldSchema={taskCustomFieldSchema.value}
            syncedTaskEnabled={syncedTask?.enabled ?? false}
            onTaskChange={setTask}
            onMetaDataKeyDown={onMetaDataKeyDown}
          />
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
                await editEvent(event);
              } else {
                await createEvent(event);
              }
            }}
            disabled={
              !canSubmit ||
              createdEvent.loading ||
              editedEvent.loading ||
              !event.eventName ||
              (event.enabledCreateNewTask && task.title === "") ||
              !isAllEventRequiredCustomFieldFilled ||
              (event.enabledCreateNewTask && !isAllTaskRequiredCustomFieldFilled)
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
