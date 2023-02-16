// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Autocomplete,
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  FormLabel,
  FormControl,
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
  const { eventName } = initialTask;
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
    description: "",
    assignee: "",
    assigner: "",
  });

  const [createdTask, createTask] = useAsyncFn(async () => {
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
    const record = `${parent}/records/${urlState?.parameters?.recordId}`;

    const description =
      JSON.stringify({
        root: {
          children: [
            {
              children: [
                {
                  sourceName: eventName,
                  sourceType: "moment",
                  type: "source",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "paragraph",
              version: 1,
            },
            ...task.description.split("\n").map((text) => ({
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text,
                  type: "text",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "paragraph",
              version: 1,
            })),
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      }) ?? task.description;
    await consoleApi.createTask({ parent, record, task: { ...task, description } });
    onClose();
  }, [consoleApi, urlState, task, onClose, eventName]);

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
        <TextField
          id="description"
          label={t("description")}
          multiline
          rows={3}
          value={task.description}
          onChange={(val) => {
            setTask((state) => ({ ...state, description: val.target.value }));
          }}
          fullWidth
          variant="standard"
        />
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <FormControl>
          <FormLabel>{t("assignee")}</FormLabel>
          <Autocomplete
            disableClearable
            options={users ?? []}
            getOptionLabel={(option) => option.getNickname()}
            renderInput={(params) => <TextField {...params} variant="standard" />}
            renderOption={(props, option) => (
              <Box component="li" {...props}>
                <img
                  style={{ width: 18, borderRadius: "50%", marginRight: 5 }}
                  src={option.getAvatar()}
                />
                {option.getNickname()}
              </Box>
            )}
            value={users?.find((user) => user.getName() === task.assignee)}
            isOptionEqualToValue={(option, value) => option.getName() === value.getName()}
            onChange={(event, option) => {
              setTask((s) => ({ ...s, assignee: option.getName() }));
            }}
          />
        </FormControl>
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
