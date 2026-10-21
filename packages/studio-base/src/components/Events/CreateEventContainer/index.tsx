// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  EventSchema,
  Event,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import EastIcon from "@mui/icons-material/East";
import {
  Button,
  Typography,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  Link,
  Alert,
} from "@mui/material";
import cloneDeep from "lodash-es/cloneDeep";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { areEqual, Time } from "@foxglove/rostime";
import { convertCustomFieldValuesMapToArray } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldForm";
import { EventForm } from "@foxglove/studio-base/components/Events/CreateEventContainer/component/EventForm";
import { TaskForm } from "@foxglove/studio-base/components/Events/CreateEventContainer/component/TaskForm";
import { useDefaultEventForm } from "@foxglove/studio-base/components/Events/CreateEventContainer/hooks";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useMomentCreationDefaults } from "@foxglove/studio-base/context/MomentCreationDefaultsContext";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import { secondsToDuration } from "@foxglove/studio-base/util/time";

import { buildMomentCustomizedFields } from "../momentDoubtful";
import { restoreMomentCustomFieldValues } from "./customFieldDefaults";
import { CreateEventForm, CreateTaskForm } from "./types";

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;
const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectProject = (store: CoreDataStore) => store.project;
const selectOrganization = (store: CoreDataStore) => store.organization;

export function getEventDurationSeconds(duration: number, durationUnit: "sec" | "nsec"): number {
  return Math.max(0, durationUnit === "sec" ? duration : duration / 1e9);
}

export function timestampFromTime(time: Time): Timestamp {
  return create(TimestampSchema, {
    seconds: BigInt(time.sec),
    nanos: time.nsec,
  });
}

export function getEventUpdateMaskPaths(startTime: Time, originalStartTime?: Time): string[] {
  const paths = [
    "displayName",
    "duration_nanos",
    "description",
    "duration",
    "customizedFields",
    "customFieldValues",
    "files",
  ];

  if (originalStartTime == undefined || !areEqual(startTime, originalStartTime)) {
    paths.unshift("triggerTime");
  }

  return paths;
}

function CreateTaskSuccessToast({ targetUrl }: { targetUrl: string }): React.ReactNode {
  const { t } = useTranslation("event");

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

export function CreateEventContainer({ onClose }: { onClose: () => void }): React.ReactNode {
  const scopeId = useMomentCreationDefaults((store) => store.id);
  const isReady = useMomentCreationDefaults((store) => store.isReady);
  const { t } = useTranslation("event");
  if (!isReady) {
    return (
      <Stack padding={3} gap={2}>
        <CircularProgress size="1rem" />
        <Typography>{t("loadingCreationContext")}</Typography>
        <Button onClick={onClose}>{t("cancel")}</Button>
      </Stack>
    );
  }
  return <CreateEventFormContainer key={scopeId} onClose={onClose} />;
}

function CreateEventFormContainer({ onClose }: { onClose: () => void }): React.ReactNode {
  const [isComposition, setIsComposition] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [enabledCreateNewTask, setEnabledCreateNewTask] = useState(false);

  const consoleApi = useConsoleApi();
  const domainConfig = getDomainConfig();

  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const project = useCoreData(selectProject);
  const organization = useCoreData(selectOrganization);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);

  const projectName = `warehouses/${externalInitConfig?.warehouseId}/projects/${externalInitConfig?.projectId}`;
  const recordName = `warehouses/${externalInitConfig?.warehouseId}/projects/${externalInitConfig?.projectId}/records/${externalInitConfig?.recordId}`;
  const fieldConfigurationUrl = `https://${domainConfig.webDomain}/${organizationSlug}/${projectSlug}/manage/advanced-settings/custom-field/moment-custom-field`;

  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshEvents = useEvents(selectRefreshEvents);
  const toModifyEvent = useEvents(selectToModifyEvent);
  const isEditing = toModifyEvent != undefined;
  const { t } = useTranslation("event");

  const rememberedValues = useMomentCreationDefaults((store) => store.customFieldValues);
  const rememberCustomFieldValues = useMomentCreationDefaults(
    (store) => store.rememberCustomFieldValues,
  );
  const isCurrentScope = useMomentCreationDefaults((store) => store.isCurrentScope);
  const hasRememberedUsers = rememberedValues.some((value) => value.value.case === "user");
  const [activeUsers, loadActiveUsers] = useAsyncFn(async () => {
    const users = await consoleApi.listOrganizationUsers();
    return new Set(
      users.filter((user) => user.active).map((user) => user.name.split("/").pop() ?? ""),
    );
  }, [consoleApi]);
  useEffect(() => {
    if (!isEditing && hasRememberedUsers) {
      void loadActiveUsers();
    }
  }, [isEditing, hasRememberedUsers, loadActiveUsers]);
  const schema = useEvents((store) => store.customFieldSchema);
  const schemaProjectName = useEvents((store) => store.customFieldSchemaProjectName);
  const schemaError = useEvents((store) => store.customFieldSchemaError);
  const refreshCustomFieldSchema = useEvents((store) => store.refreshCustomFieldSchema);
  const hasSchemaError = !isEditing && schemaError?.projectName === projectName;
  const hasPeopleError = !isEditing && hasRememberedUsers && activeUsers.error != undefined;
  const hasDefaultsError = hasSchemaError || hasPeopleError;
  const isRestoringDefaults =
    !isEditing &&
    rememberedValues.length > 0 &&
    (schema == undefined ||
      schemaProjectName !== projectName ||
      (hasRememberedUsers &&
        (activeUsers.loading || activeUsers.value == undefined || hasPeopleError)));
  const restoredValues = useMemo(
    () =>
      restoreMomentCustomFieldValues(
        schemaProjectName === projectName ? (schema?.properties ?? []) : [],
        rememberedValues,
        activeUsers.value,
      ),
    [schema, schemaProjectName, projectName, rememberedValues, activeUsers.value],
  );
  const defaultEventForm = useDefaultEventForm(restoredValues);

  const eventForm = useForm<CreateEventForm>({
    defaultValues: defaultEventForm,
  });

  useEffect(() => {
    if (!isEditing) {
      // A schema may arrive after the dialog opens. A cleared field is still a
      // CustomFieldValue object, so it is never mistaken for an untouched field.
      const current = eventForm.getValues("customFieldValues");
      for (const [id, value] of Object.entries(restoredValues)) {
        if (current?.[id] == undefined) {
          eventForm.setValue(`customFieldValues.${id}`, cloneDeep(value));
        }
      }
    }
  }, [eventForm, isEditing, restoredValues]);

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
    const onCompositionStart = () => {
      setIsComposition(true);
    };
    const onCompositionEnd = () => {
      setIsComposition(false);
    };
    document.addEventListener("compositionstart", onCompositionStart);
    document.addEventListener("compositionend", onCompositionEnd);

    return () => {
      document.removeEventListener("compositionstart", onCompositionStart);
      document.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const handleCreateTask = async (event: Event) => {
    const task = taskForm.getValues();

    try {
      const newTask = await consoleApi.createTask({
        parent: projectName,
        task: {
          ...task,
          customFieldValues: convertCustomFieldValuesMapToArray(task.customFieldValues ?? {}),
          description: task.description,
        },
        event,
      });
      const targetUrl = `${
        window.location.origin
      }/${organizationSlug}/${projectSlug}/tasks/general-tasks/${newTask.name.split("/").pop()}`;

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
    if (isSubmittingRef.current || isRestoringDefaults) {
      return;
    }

    isSubmittingRef.current = true;
    setIsLoading(true);
    let shouldResetSubmitting = true;

    try {
      const isEventFormValid = await eventForm.trigger();
      let isTaskFormValid = true;

      if (enabledCreateNewTask) {
        isTaskFormValid = await taskForm.trigger();
      }

      if (!isEventFormValid || !isTaskFormValid) {
        return;
      }

      const event = eventForm.getValues();
      const customFieldValues = cloneDeep(
        convertCustomFieldValuesMapToArray(event.customFieldValues ?? {}),
      );

      if (event.startTime == undefined || event.duration == undefined) {
        toast.error(t("startTimeAndDurationRequired"));
        return;
      }

      const filteredMeta = event.metadataEntries.filter(
        (entry) =>
          entry.key.length > 0 && entry.value.length > 0 && entry.key.trim() !== "_doubtful",
      );

      const keyedMetadata = Object.fromEntries(
        filteredMeta.map((entry) => [entry.key.trim(), entry.value.trim()]),
      );
      const durationSeconds = getEventDurationSeconds(event.duration, event.durationUnit);

      let imageFiles = toModifyEvent?.files;

      if (event.imageFile) {
        const imgId = uuidv4();

        const imgFileDisplayName = `${imgId}.${
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
          ((event.imageFile as any).path || event.imageFile.name).split(".").pop()
        }`;

        await consoleApi.uploadEventPicture({
          recordName,
          file: event.imageFile,
          filename: imgFileDisplayName,
        });

        imageFiles = [`${recordName}/files/.cos/moments/${imgFileDisplayName}`];
      } else if (isEditing) {
        imageFiles = event.imgUrl ? (toModifyEvent.files ?? []) : [];
      } else {
        imageFiles = [];
      }

      const newEvent = create(EventSchema, {
        name: toModifyEvent?.name ?? "",
        displayName: event.eventName,
        triggerTime: timestampFromTime(event.startTime),
        duration: secondsToDuration(durationSeconds),
        description: event.description,
        files: imageFiles,
        customFieldValues,
        customizedFields: buildMomentCustomizedFields({
          fields: keyedMetadata,
          isDoubtful: event.isDoubtful === true,
        }),
      });

      if (isEditing) {
        const maskArray = getEventUpdateMaskPaths(event.startTime, toModifyEvent.startTime);

        await consoleApi.updateEvent({
          event: newEvent,
          updateMask: create(FieldMaskSchema, { paths: maskArray }),
        });
        toast.success(t("editMomentSuccess"));
      } else {
        const res = await consoleApi.createEvent({
          event: newEvent,
          parent: projectName,
          recordName,
        });

        rememberCustomFieldValues(newEvent.customFieldValues);

        toast.success(t("createMomentSuccess"));
        if (enabledCreateNewTask) {
          await handleCreateTask(res);
        }
      }

      shouldResetSubmitting = false;
      if (isCurrentScope()) {
        refreshEvents();
      }
      if (isMountedRef.current) {
        onClose();
      }
    } catch (error) {
      console.error(error);
      toast.error(t("createMomentFailed"));
    } finally {
      if (shouldResetSubmitting && isMountedRef.current) {
        isSubmittingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  return (
    <>
      <Stack paddingX={3} paddingY={2} style={{ width: "500px" }}>
        <Stack>
          <Typography variant="h4">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
        </Stack>

        <EventForm form={eventForm} onMetaDataKeyDown={onMetaDataKeyDown} />

        {hasSchemaError && (
          <Alert
            severity="error"
            action={<Button onClick={refreshCustomFieldSchema}>{t("retryCustomFields")}</Button>}
          >
            {t("restoreCustomFieldsFailed")}
          </Alert>
        )}
        {hasPeopleError && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void loadActiveUsers();
                }}
              >
                {t("retryPeople")}
              </Button>
            }
          >
            {t("restorePeopleFailed")}
          </Alert>
        )}

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

        <Stack paddingTop={2} direction="row" justifyContent="space-between" gap={2}>
          <Stack>
            <Button
              variant="text"
              onClick={() => {
                window.open(fieldConfigurationUrl, "_blank");
              }}
            >
              {t("fieldConfiguration")}
            </Button>
          </Stack>
          <Stack gap={2} direction="row">
            <Button variant="outlined" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              variant="contained"
              id="create-moment"
              ref={createMomentBtnRef}
              disabled={isLoading || isRestoringDefaults}
              onClick={onSubmit}
            >
              {(isLoading || (isRestoringDefaults && !hasDefaultsError)) && (
                <CircularProgress color="inherit" size="1rem" style={{ marginRight: "0.5rem" }} />
              )}
              {isEditing ? t("save") : t("createMoment")}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </>
  );
}
