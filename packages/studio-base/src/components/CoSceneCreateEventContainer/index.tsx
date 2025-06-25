// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Timestamp, FieldMask } from "@bufbuild/protobuf";
import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import EastIcon from "@mui/icons-material/East";
import {
  Button,
  Typography,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  Link,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import { EventForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/component/EventForm";
import { TaskForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/component/TaskForm";
import { useDefaultEventForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/hooks";
import { convertCustomFieldValuesMapToArray } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldForm";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { secondsToDuration } from "@foxglove/studio-base/util/time";

import { CreateEventForm, CreateTaskForm } from "./types";

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

function CreateTaskSuccessToast({ targetUrl }: { targetUrl: string }): React.ReactNode {
  const { t } = useTranslation("cosEvent");

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      {t("createTaskSuccess")}
      <Link href={targetUrl} target="_blank" underline="hover" color="inherit">
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("toView")}
          <EastIcon />
        </Stack>
      </Link>
    </Stack>
  );
}

export function CoSceneCreateEventContainer({ onClose }: { onClose: () => void }): React.ReactNode {
  const [isComposition, setIsComposition] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [enabledCreateNewTask, setEnabledCreateNewTask] = useState(false);

  const consoleApi = useConsoleApi();

  const baseInfo = useBaseInfo(selectBaseInfo);

  const projectName = `warehouses/${baseInfo.value?.warehouseId}/projects/${baseInfo.value?.projectId}`;
  const recordName = `warehouses/${baseInfo.value?.warehouseId}/projects/${baseInfo.value?.projectId}/records/${baseInfo.value?.recordId}`;

  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);

  const refreshEvents = useEvents(selectRefreshEvents);
  const toModifyEvent = useEvents(selectToModifyEvent);
  const isEditing = toModifyEvent != undefined;
  const { t } = useTranslation("cosEvent");

  const defaultEventForm = useDefaultEventForm();

  const eventForm = useForm<CreateEventForm>({
    defaultValues: defaultEventForm,
  });

  const taskForm = useForm<CreateTaskForm>({
    defaultValues: {
      title: "",
      description: "",
      assignee: "",
      assigner: "",
      needSyncTask: false,
    },
  });

  const onMetaDataKeyDown = useCallback(
    (keyboardEvent: React.KeyboardEvent) => {
      if (keyboardEvent.key === "Enter" && !isComposition) {
        createMomentBtnRef.current?.click();
      }
    },
    [createMomentBtnRef, isComposition],
  );

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

  const handleCreateTask = async (event: Event) => {
    const task = taskForm.getValues();

    const description: string =
      JSON.stringify({
        root: {
          children: [
            {
              children: [
                {
                  sourceName: event.name,
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
        parent: projectName,
        task: {
          ...task,
          customFieldValues: convertCustomFieldValuesMapToArray(task.customFieldValues ?? {}),
          description,
        },
        event,
      });
      const targetUrl = `${window.location.origin}/${baseInfo.value?.organizationSlug}/${baseInfo
        .value?.projectSlug}/tasks/general-tasks/${newTask.name.split("/").pop()}`;

      toast.success(<CreateTaskSuccessToast targetUrl={targetUrl} />);
      if (task.needSyncTask) {
        await consoleApi.syncTask({ name: newTask.name });
      }
    } catch (error) {
      console.error(error);
      toast.error(t("createTaskFailed"));
    }
  };

  const onSubmit = async () => {
    setIsLoading(true);
    const isEventFormValid = await eventForm.trigger();
    let isTaskFormValid = true;

    if (enabledCreateNewTask) {
      isTaskFormValid = await taskForm.trigger();
    }

    if (!isEventFormValid || !isTaskFormValid) {
      setIsLoading(false);
      return;
    }

    try {
      const event = eventForm.getValues();

      if (event.startTime == undefined || event.duration == undefined) {
        toast.error(t("startTimeAndDurationRequired"));
        return;
      }

      const filteredMeta = event.metadataEntries.filter(
        (entry) => entry.key.length > 0 && entry.value.length > 0,
      );

      const keyedMetadata = Object.fromEntries(
        filteredMeta.map((entry) => [entry.key.trim(), entry.value.trim()]),
      );

      let imageFiles = undefined;

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

        imageFiles = [`${recordName}/files/.cos/moments/${imgFileDisplayName}`];
      }

      const newEvent = new Event({
        name: toModifyEvent?.name ?? "",
        displayName: event.eventName,
        triggerTime: Timestamp.fromDate(event.startTime),
        duration:
          event.durationUnit === "sec"
            ? secondsToDuration(event.duration)
            : secondsToDuration(event.duration / 1e9),
        description: event.description,
        files: imageFiles,
        customFieldValues: convertCustomFieldValuesMapToArray(event.customFieldValues ?? {}),
        customizedFields: keyedMetadata,
      });

      if (isEditing) {
        const maskArray = [
          "displayName",
          "duration_nanos",
          "description",
          "duration",
          "customizedFields",
          "customFieldValues",
        ];

        if (event.imageFile) {
          maskArray.push("files");
        }

        await consoleApi.updateEvent({
          event: newEvent,
          updateMask: new FieldMask({ paths: maskArray }),
        });
        toast.success(t("editMomentSuccess"));
      } else {
        const res = await consoleApi.createEvent({
          event: newEvent,
          parent: projectName,
          recordName,
        });

        toast.success(t("createMomentSuccess"));
        if (enabledCreateNewTask) {
          await handleCreateTask(res);
        }
      }

      refreshEvents();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(t("createMomentFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Stack paddingX={3} paddingY={2}>
        <Stack>
          <Typography variant="h4">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
        </Stack>

        <EventForm form={eventForm} onMetaDataKeyDown={onMetaDataKeyDown} />

        {!isEditing && consoleApi.createTask.permission() && (
          <Stack paddingTop={2}>
            <FormControlLabel
              disableTypography
              checked={enabledCreateNewTask}
              control={
                <Checkbox
                  size="medium"
                  checked={enabledCreateNewTask}
                  onChange={() => {
                    setEnabledCreateNewTask(!enabledCreateNewTask);
                  }}
                />
              }
              label={t("createNewTask")}
            />
          </Stack>
        )}

        {enabledCreateNewTask && <TaskForm form={taskForm} />}

        <Stack paddingTop={2} direction="row" justifyContent="end" gap={2}>
          <Button variant="outlined" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            id="create-moment"
            ref={createMomentBtnRef}
            disabled={isLoading}
            onClick={onSubmit}
          >
            {isLoading && (
              <CircularProgress color="inherit" size="1rem" style={{ marginRight: "0.5rem" }} />
            )}
            {isEditing ? t("edit") : t("createMoment")}
          </Button>
        </Stack>
      </Stack>
    </>
  );
}
