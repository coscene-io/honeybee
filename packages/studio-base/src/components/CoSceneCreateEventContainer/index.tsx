// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Button, Typography, CircularProgress } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { EventForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/component/EventForm";
import { TaskForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/component/TaskForm";
import { useDefaultEventForm } from "@foxglove/studio-base/components/CoSceneCreateEventContainer/hooks";
import Stack from "@foxglove/studio-base/components/Stack";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";

import { CreateEventForm, CreateTaskForm } from "./types";

const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;

const useStyles = makeStyles()(() => ({
  containerFooter: {
    display: "flex",
    justifyContent: "end",
    gap: "8px",
    padding: "24px",
  },
}));

export function CoSceneCreateEventContainer({ onClose }: { onClose: () => void }): React.ReactNode {
  const [isComposition, setIsComposition] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);

  const toModifyEvent = useEvents(selectToModifyEvent);
  const isEditing = toModifyEvent != undefined;
  const { t } = useTranslation("cosEvent");

  const { classes } = useStyles();

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

  const onSubmit = async () => {
    const isEventFormValid = await eventForm.trigger();

    if (isEventFormValid) {
      console.log("eventForm", eventForm.getValues());
    } else {
      console.log("eventForm is not valid");
    }
  };

  return (
    <>
      <Stack>
        <Stack paddingX={3} paddingTop={2}>
          <Typography variant="h4">{isEditing ? t("editMoment") : t("createMoment")}</Typography>
        </Stack>
        <EventForm form={eventForm} onMetaDataKeyDown={onMetaDataKeyDown} />
        <TaskForm form={taskForm} />

        <div className={classes.containerFooter}>
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
        </div>
      </Stack>
    </>
  );
}
