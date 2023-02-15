// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { useImmer } from "use-immer";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function CreateTaskDialog({
  onClose,
  initialTask,
}: {
  onClose: () => void;
  initialTask: { title: string; eventName: string };
}): JSX.Element {
  const urlState = useMessagePipeline(selectUrlState);
  const { t } = useTranslation("moment");
  const consoleApi = useConsoleApi();

  const [task, setTask] = useImmer<{
    title: string;
    description: string;
    assignee: string;
    assigner: string;
  }>({
    title: initialTask.title,
    description: `{"root":{"children":[{"children":[{"sourceName":"${initialTask.eventName}","sourceType":"moment","type":"source","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}`,
    assignee: "users/373035b6-2471-4d40-9a67-364f09192a9e",
    assigner: "users/c90becf2-66bf-4e92-bf71-5142266abb9d",
  });

  const [createdTask, createTask] = useAsyncFn(async () => {
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
    const record = `${parent}/records/${urlState?.parameters?.recordId}`;

    await consoleApi.createTask({ parent, record, task });
    onClose();
  }, [consoleApi, urlState, task, onClose]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Stack paddingX={3} paddingTop={2}>
        <Typography variant="h2">{t("createNewTask")}</Typography>
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
          id="title"
          label={t("name", { ns: "general" })}
          multiline
          maxRows={1}
          value={task.title}
          onChange={(val) => {
            setTask((state) => ({ ...state, title: val.target.value }));
          }}
          fullWidth
          variant="standard"
        />
      </Stack>
      <DialogActions>
        <Button variant="outlined" size="large" onClick={onClose}>
          {t("cancel", { ns: "general" })}
        </Button>
        <Button
          variant="contained"
          size="large"
          onClick={createTask}
          disabled={createdTask.loading || !task.title}
        >
          {createdTask.loading && (
            <CircularProgress color="inherit" size="1rem" style={{ marginRight: "0.5rem" }} />
          )}
          {t("createTask")}
        </Button>
      </DialogActions>
      {createdTask.error?.message && <Alert severity="error">{createdTask.error.message}</Alert>}
    </Dialog>
  );
}
