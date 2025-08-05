import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import {
  getTaskStateDisplayName,
  TaskStateType,
} from "@foxglove/studio-base/components/Tasks/TasksList/utils/taskFilterUtils";
import { AccessTime, Autorenew, CheckCircleOutline } from "@mui/icons-material";
import { Chip } from "@mui/material";
import { useTranslation } from "react-i18next";

const TaskStateChipMap: Record<
  TaskStateType,
  {
    color: "default" | "primary" | "success" | "warning";
    icon: React.ReactElement;
  }
> = {
  [TaskStateEnum_TaskState.PENDING]: {
    color: "default",
    icon: <AccessTime style={{ fontSize: "14px" }} />,
  },
  [TaskStateEnum_TaskState.PROCESSING]: {
    color: "primary",
    icon: <Autorenew style={{ fontSize: "14px" }} />,
  },
  [TaskStateEnum_TaskState.SUCCEEDED]: {
    color: "success",
    icon: <CheckCircleOutline style={{ fontSize: "14px" }} />,
  },
};

function TaskStateValueRender({ value }: { value: TaskStateType }) {
  const { t } = useTranslation("task");
  return (
    <Chip
      label={getTaskStateDisplayName(value, t)}
      size="small"
      icon={TaskStateChipMap[value].icon}
      color={TaskStateChipMap[value].color || "default"}
      style={{
        marginRight: "0px",
        fontSize: "12px",
        transform: "scale(0.9)",
        transformOrigin: "left center",
        borderRadius: "4px",
      }}
    />
  );
}

export { TaskStateChipMap, TaskStateValueRender };
