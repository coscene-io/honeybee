// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { User } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/user_pb";
import {
  TextField,
  FormLabel,
  FormControl,
  FormControlLabel,
  Checkbox,
  Tooltip,
} from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import {
  CustomFieldValuesForm,
  FormWithCustomFieldValues,
} from "@foxglove/studio-base/components/CustomFieldProperty/form/CustomFieldValuesForm";
import Stack from "@foxglove/studio-base/components/Stack";
import { UserSelect } from "@foxglove/studio-base/components/UserSelect";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";

import { CreateTaskForm } from "../types";

const useStyles = makeStyles()((_theme) => ({
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
}));

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectTaskCustomFieldSchema = (store: TaskStore) => store.customFieldSchema;

const log = Logger.getLogger(__filename);

interface TaskFormProps {
  form: UseFormReturn<CreateTaskForm>;
  onMetaDataKeyDown?: (keyboardEvent: React.KeyboardEvent) => void;
}

export function TaskForm({ form, onMetaDataKeyDown }: TaskFormProps): React.ReactNode {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");
  const consoleApi = useConsoleApi();

  const { control, watch } = form;
  const watchedValues = watch();

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = asyncBaseInfo.value ?? {};

  const taskCustomFieldSchema = useTasks(selectTaskCustomFieldSchema);

  // Get sync task metadata
  const { value: syncedTask } = useAsync(async () => {
    if (!baseInfo.warehouseId || !baseInfo.projectId) {
      return { enabled: false };
    }

    const parent = `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}/ticketSystem`;

    try {
      const result = await consoleApi.getTicketSystemMetadata({ parent });
      return {
        ...result,
        enabled: result.jiraEnabled || result.onesEnabled || result.teambitionEnabled,
      };
    } catch (error) {
      log.error(error);
      return { enabled: false };
    }
  }, [baseInfo.warehouseId, baseInfo.projectId, consoleApi]);

  return (
    <Stack>
      <Stack paddingTop={2}>
        <Controller
          name="title"
          control={control}
          rules={{
            required: true,
          }}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              size="small"
              variant="filled"
              fullWidth
              label={
                <>
                  <span className={classes.requiredFlags}>*</span>
                  {t("taskName")}
                </>
              }
              maxRows={1}
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              onKeyDown={onMetaDataKeyDown}
            />
          )}
        />
      </Stack>

      <Stack paddingTop={2}>
        <Controller
          name="description"
          control={control}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              size="small"
              variant="filled"
              id="task-description"
              label={t("taskDescription")}
              rows={3}
              fullWidth
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              onKeyDown={onMetaDataKeyDown}
            />
          )}
        />
      </Stack>

      <Stack paddingTop={2}>
        <FormControl>
          <FormLabel>{t("taskAssignee")}</FormLabel>
          <Controller
            name="assignee"
            control={control}
            render={({ field, fieldState }) => (
              <UserSelect
                value={field.value}
                onChange={(user: User) => {
                  field.onChange(user.name);
                }}
                onMetaDataKeyDown={onMetaDataKeyDown}
                error={!!fieldState.error}
              />
            )}
          />
        </FormControl>
      </Stack>

      {taskCustomFieldSchema && (
        <Stack paddingTop={2} gap={2}>
          <CustomFieldValuesForm
            form={form as unknown as FormWithCustomFieldValues}
            properties={taskCustomFieldSchema.properties}
          />
        </Stack>
      )}

      <Stack paddingTop={2}>
        {syncedTask?.enabled ?? false ? (
          <Controller
            name="needSyncTask"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                disableTypography
                checked={field.value}
                control={
                  <Checkbox
                    size="medium"
                    checked={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.checked);
                    }}
                  />
                }
                label={t("syncTask")}
              />
            )}
          />
        ) : (
          <Tooltip title={t("syncTaskTooltip")} placement="top-start">
            <FormControlLabel
              disableTypography
              checked={watchedValues.needSyncTask}
              control={
                <Checkbox size="medium" checked={watchedValues.needSyncTask} disabled={true} />
              }
              label={t("syncTask")}
            />
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}
