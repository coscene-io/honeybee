// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Timestamp, FieldMask } from "@bufbuild/protobuf";
import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import { useSnackbar } from "notistack";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { secondsToDuration } from "@foxglove/studio-base/util/time";

import { EventFormData, ToModifyEvent } from "../types";

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;

interface UseEventOperationsProps {
  onClose: () => void;
  projectName?: string;
  recordName?: string;
  toModifyEvent?: ToModifyEvent;
  createTask: (params: { targetEvent: Event }) => Promise<void>;
}

export function useEventOperations({
  onClose,
  projectName,
  recordName,
  toModifyEvent,
  createTask,
}: UseEventOperationsProps): {
  createdEvent: ReturnType<typeof useAsyncFn>[0];
  createEvent: ReturnType<typeof useAsyncFn>[1];
  editedEvent: ReturnType<typeof useAsyncFn>[0];
  editEvent: ReturnType<typeof useAsyncFn>[1];
} {
  const consoleApi = useConsoleApi();
  const { enqueueSnackbar } = useSnackbar();
  const { t } = useTranslation("cosEvent");
  const refreshEvents = useEvents(selectRefreshEvents);

  // create moment ---------------------
  const [createdEvent, createEvent] = useAsyncFn(
    async (event: EventFormData) => {
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

      newEvent.customFieldValues = event.customFieldValues ?? [];

      if (projectName == undefined || recordName == undefined) {
        enqueueSnackbar(t("createMomentFailed"), { variant: "error" });
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
    },
    [consoleApi, createTask, enqueueSnackbar, onClose, projectName, recordName, refreshEvents, t],
  );

  // edit moment ---------------------
  const [editedEvent, editEvent] = useAsyncFn(
    async (event: EventFormData) => {
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

      newEvent.customFieldValues = event.customFieldValues ?? [];

      const maskArray = [
        "displayName",
        "duration_nanos",
        "description",
        "duration",
        "customizedFields",
        "customFieldValues",
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
    },
    [consoleApi, enqueueSnackbar, onClose, recordName, refreshEvents, t, toModifyEvent?.name],
  );

  return {
    createdEvent,
    createEvent,
    editedEvent,
    editEvent,
  };
}
