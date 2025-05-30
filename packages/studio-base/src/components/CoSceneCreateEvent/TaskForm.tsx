// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Property } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  TextField,
  Tooltip,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { Updater } from "use-immer";

import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import Stack from "@foxglove/studio-base/components/Stack";
import { UserSelect } from "@foxglove/studio-base/components/UserSelect";

import { TaskFormData } from "./types";

const useStyles = makeStyles()(() => ({
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
}));

interface TaskFormProps {
  task: TaskFormData;
  taskCustomFieldSchema?: { properties: Property[] };
  syncedTaskEnabled: boolean;
  onTaskChange: Updater<TaskFormData>;
  onMetaDataKeyDown: (keyboardEvent: React.KeyboardEvent) => void;
}

export function TaskForm({
  task,
  taskCustomFieldSchema,
  syncedTaskEnabled,
  onTaskChange,
  onMetaDataKeyDown,
}: TaskFormProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");

  return (
    <>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
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
          value={task.title}
          onChange={(val) => {
            onTaskChange((draft) => {
              draft.title = val.target.value;
            });
          }}
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>

      <Stack paddingX={3} paddingTop={2}>
        <TextField
          size="small"
          variant="filled"
          id="description"
          label={t("taskDescription")}
          rows={3}
          value={task.description}
          onChange={(val) => {
            onTaskChange((draft) => {
              draft.description = val.target.value;
            });
          }}
          fullWidth
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>

      <Stack paddingX={3} paddingTop={2}>
        <FormControl>
          <FormLabel>{t("taskAssignee")}</FormLabel>
          <UserSelect
            value={task.assignee}
            onChange={(user) => {
              onTaskChange((draft) => {
                draft.assignee = user.name;
              });
            }}
            onMetaDataKeyDown={onMetaDataKeyDown}
          />
        </FormControl>
      </Stack>

      {taskCustomFieldSchema && (
        <Stack paddingX={3} paddingTop={2} gap={2}>
          {/* custom field */}
          <CustomFieldValuesFields
            variant="secondary"
            properties={taskCustomFieldSchema.properties}
            customFieldValues={task.customFieldValues}
            onChange={(customFieldValues) => {
              onTaskChange((draft) => {
                draft.customFieldValues = customFieldValues;
              });
            }}
          />
        </Stack>
      )}

      <Stack paddingX={3} paddingTop={2}>
        {syncedTaskEnabled ? (
          <FormControlLabel
            disableTypography
            checked={task.needSyncTask}
            control={
              <Checkbox
                size="medium"
                checked={task.needSyncTask}
                onChange={(e) => {
                  onTaskChange((draft) => {
                    draft.needSyncTask = e.target.checked;
                  });
                }}
              />
            }
            label={t("syncTask")}
          />
        ) : (
          <Tooltip title={t("syncTaskTooltip")} placement="top-start">
            <FormControlLabel
              disableTypography
              checked={task.needSyncTask}
              control={
                <Checkbox
                  size="medium"
                  checked={task.needSyncTask}
                  onChange={(e) => {
                    onTaskChange((draft) => {
                      draft.needSyncTask = e.target.checked;
                    });
                  }}
                  disabled={true}
                />
              }
              label={t("syncTask")}
            />
          </Tooltip>
        )}
      </Stack>
    </>
  );
}
