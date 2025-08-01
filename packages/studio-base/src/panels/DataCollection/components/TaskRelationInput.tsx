// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Clear as ClearIcon } from "@mui/icons-material";
import { FormControl, InputLabel, TextField, Box, IconButton } from "@mui/material";
import { TFunction } from "i18next";
import { memo } from "react";

import { CollectionStage } from "../types";

interface TaskRelationInputProps {
  currentFocusedTask?: Task;
  currentCollectionStage: CollectionStage;
  onClearTask: () => void;
  t: TFunction<"dataCollection">;
}

export const TaskRelationInput = memo(function TaskRelationInput({
  currentFocusedTask,
  currentCollectionStage,
  onClearTask,
  t,
}: TaskRelationInputProps) {
  return (
    <Box minWidth={200}>
      <FormControl fullWidth size="small">
        <InputLabel id="task-relation-select-label">{t("autoLinkToTask")}</InputLabel>
        <TextField
          id="task-relation-display"
          size="small"
          fullWidth
          value={String(`#${currentFocusedTask?.number ?? ""}`)}
          placeholder={t("clickTaskInPanel")}
          slotProps={{
            input: {
              readOnly: true,
              endAdornment: currentFocusedTask ? (
                <IconButton
                  aria-label={t("clearTaskLink")}
                  disabled={currentCollectionStage === "collecting"}
                  onClick={onClearTask}
                  size="small"
                  style={{ padding: 4 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ) : undefined,
              style: {
                color: currentFocusedTask?.title ? "inherit" : "#999",
              },
            },
          }}
        />
      </FormControl>
    </Box>
  );
});
