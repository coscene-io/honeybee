// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { AccessTime, Autorenew, CheckCircleOutline } from "@mui/icons-material";
import { Chip } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  getTaskStateDisplayName,
  TaskStateType,
} from "@foxglove/studio-base/components/Tasks/TasksList/utils/taskFilterUtils";

const useStyles = makeStyles()((theme) => ({
  baseChip: {
    marginRight: "0px",
    fontSize: "12px",
    transform: "scale(0.9)",
    transformOrigin: "left center",
    borderRadius: "4px",
    "& .MuiChip-icon": {
      fontSize: 14,
    },
  },
  pendingChip: {
    color: "#fff",
    backgroundColor: theme.palette.text.secondary,
  },
  pendingIcon: {
    color: `#fff !important`,
  },
}));

function TaskStateItem({ state }: { state: TaskStateType }): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("task");
  const TaskStateChipMap: Record<
    TaskStateType,
    {
      color: "default" | "primary" | "success" | "warning";
      icon: React.ElementType;
    }
  > = {
    [TaskStateEnum_TaskState.PENDING]: {
      color: "default",
      icon: AccessTime,
    },
    [TaskStateEnum_TaskState.PROCESSING]: {
      color: "primary",
      icon: Autorenew,
    },
    [TaskStateEnum_TaskState.SUCCEEDED]: {
      color: "success",
      icon: CheckCircleOutline,
    },
  };
  const Icon = TaskStateChipMap[state].icon;
  return (
    <Chip
      label={getTaskStateDisplayName(state, t)}
      size="small"
      icon={
        <Icon
          className={cx({ [classes.pendingIcon]: state === TaskStateEnum_TaskState.PENDING })}
        />
      }
      color={TaskStateChipMap[state].color}
      className={cx(classes.baseChip, {
        [classes.pendingChip]: state === TaskStateEnum_TaskState.PENDING,
      })}
    />
  );
}

export { TaskStateItem };
