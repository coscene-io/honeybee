// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  FormLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAsync, useAsyncFn } from "react-use";
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
    assignee: "",
    assigner: "users/c90becf2-66bf-4e92-bf71-5142266abb9d",
  });

  const [createdTask, createTask] = useAsyncFn(async () => {
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
    const record = `${parent}/records/${urlState?.parameters?.recordId}`;

    await consoleApi.createTask({ parent, record, task });
    onClose();
  }, [consoleApi, urlState, task, onClose]);

  const { value: users } = useAsync(async () => {
    return await consoleApi.listOrganizationUsers();
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Stack paddingX={3} paddingTop={2}>
        <Typography variant="h2">{t("createNewTask")}</Typography>
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
          fullWidth
          variant="standard"
          label={t("name", { ns: "general" })}
          multiline
          maxRows={1}
          value={task.title}
          onChange={(val) => {
            setTask((state) => ({ ...state, title: val.target.value }));
          }}
        />
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <FormLabel>{t("assignee")}</FormLabel>
        <Select
          fullWidth
          variant="standard"
          value={task.assignee}
          onChange={(event) => {
            setTask((s) => ({ ...s, assignee: event.target.value }));
          }}
        >
          {users?.map((user, index) => {
            return (
              <MenuItem key={index} value={user.getName()}>
                {user.getNickname()}
              </MenuItem>
            );
          })}
        </Select>
      </Stack>
      <DialogActions>
        <Button variant="outlined" size="large" onClick={onClose}>
          {t("cancel", { ns: "general" })}
        </Button>
        <Button
          variant="contained"
          size="large"
          onClick={createTask}
          disabled={createdTask.loading || !task.title || !task.assignee}
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
