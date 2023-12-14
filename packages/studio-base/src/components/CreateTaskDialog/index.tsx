// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import {
  Autocomplete,
  Alert,
  // eslint-disable-next-line no-restricted-imports
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  FormLabel,
  FormControl,
  TextField,
  Typography,
  FormControlLabel,
  Checkbox,
  Tooltip,
} from "@mui/material";
import { useSnackbar } from "notistack";
import PinyinMatch from "pinyin-match";
import { KeyboardEvent, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAsync, useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";
import { useImmer } from "use-immer";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneRecordStore,
  useRecord,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectRecord = (state: CoSceneRecordStore) => state.record;

const useStyles = makeStyles()(() => ({
  avatar: {
    width: 18,
    borderRadius: "50%",
    marginRight: 5,
  },
  circularProgress: {
    marginRight: "0.5rem",
  },
}));

export function CreateTaskDialog({
  onClose,
  initialTask,
  event,
}: {
  onClose: () => void;
  initialTask: { title: string; eventName: string; description: string };
  event: Event;
}): JSX.Element {
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" &&
    localStorage.getItem("honeybeeDemoStatus") === "start";

  const { classes } = useStyles();
  const { eventName } = initialTask;
  const urlState = useMessagePipeline(selectUrlState);
  const { t } = useTranslation("cosEvent");
  const consoleApi = useConsoleApi();
  const recordInfo = useRecord(selectRecord);
  const createMomentBtnRef = useRef<HTMLButtonElement>(ReactNull);
  const { enqueueSnackbar } = useSnackbar();
  const [needSyncTask, setNeedSyncTask] = useImmer<boolean>(false);

  const [task, setTask] = useImmer<{
    title: string;
    description: string;
    assignee: string;
    assigner: string;
  }>({
    title: initialTask.title,
    description: initialTask.description,
    assignee: "",
    assigner: "",
  });

  const onMetaDataKeyDown = useCallback(
    (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Enter") {
        createMomentBtnRef.current?.click();
      }
    },
    [createMomentBtnRef],
  );

  const { value: syncedTask } = useAsync(async () => {
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}/ticketSystem`;
    return await consoleApi.getTicketSystemMetadata({ parent });
  });

  const jiraEnabled = syncedTask?.getJiraEnabled() === true;
  const onesEnabled = syncedTask?.getOnesEnabled() === true;

  const [, syncTask] = useAsyncFn(async (name: string) => {
    try {
      await consoleApi.syncTask({ name });
      enqueueSnackbar(t("syncTaskSuccess"), { variant: "success" });
    } catch (e) {
      enqueueSnackbar(t("syncTaskFailed"), { variant: "error" });
    }
  });

  const [createdTask, createTask] = useAsyncFn(async () => {
    const parent = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
    const record = recordInfo.value?.getName() ?? "";

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
    try {
      const newTask = await consoleApi.createTask({
        parent,
        record,
        task: { ...task, description },
        event,
      });
      enqueueSnackbar(t("createTaskSuccess"), { variant: "success" });
      if (needSyncTask) {
        await syncTask(newTask.getName());
      }
      onClose();
    } catch (e) {
      enqueueSnackbar(t("createTaskFailed"), { variant: "error" });
    }
  }, [
    consoleApi,
    urlState,
    task,
    onClose,
    eventName,
    recordInfo.value,
    enqueueSnackbar,
    t,
    event,
    needSyncTask,
    syncTask,
  ]);

  const { value: users } = useAsync(async () => {
    return await consoleApi.listOrganizationUsers();
  });

  const activatedUsers = users?.filter((user) => user.getActive());

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Stack paddingX={3} paddingTop={2}>
        <Typography variant="h2">{t("createNewTask")}</Typography>
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
          fullWidth
          variant="standard"
          label={t("name", { ns: "cosGeneral" })}
          maxRows={1}
          value={task.title}
          onChange={(val) => {
            setTask((state) => ({ ...state, title: val.target.value }));
          }}
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
          id="description"
          label={t("description")}
          rows={3}
          value={task.description}
          onChange={(val) => {
            setTask((state) => ({ ...state, description: val.target.value }));
          }}
          fullWidth
          variant="standard"
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        <FormControl>
          <FormLabel>{t("assignee")}</FormLabel>
          <Autocomplete
            disableClearable
            options={activatedUsers ?? []}
            getOptionLabel={(option) => option.getNickname()}
            renderInput={(params) => <TextField {...params} autoFocus variant="standard" />}
            renderOption={(props, option) => (
              <Box component="li" {...props} key={option.getName()}>
                <img className={classes.avatar} src={option.getAvatar()} />
                {option.getNickname()}
              </Box>
            )}
            value={activatedUsers?.find((user) => user.getName() === task.assignee)}
            isOptionEqualToValue={(option, value) => option.getName() === value.getName()}
            onChange={(_event, option) => {
              setTask((s) => ({ ...s, assignee: option.getName() }));
            }}
            filterOptions={(options, { inputValue }) => {
              if (!inputValue) {
                return options;
              }
              return options.filter((option) => {
                const pinyinMatch = PinyinMatch.match(option.getNickname(), inputValue);
                return option.getNickname().includes(inputValue) || pinyinMatch !== false;
              });
            }}
            disabled={isDemoSite}
            inputValue={isDemoSite ? "demo" : undefined}
            onKeyDown={onMetaDataKeyDown}
          />
        </FormControl>
      </Stack>
      <Stack paddingX={3} paddingTop={2}>
        {!jiraEnabled && !onesEnabled ? (
          <Tooltip title={t("syncTaskTooltip")} placement="top-start">
            <FormControlLabel
              disableTypography
              checked={needSyncTask}
              control={
                <Checkbox
                  size="medium"
                  checked={needSyncTask}
                  onChange={(e) => {
                    setNeedSyncTask(e.target.checked);
                  }}
                  disabled={true}
                />
              }
              label={t("syncTask")}
            />
          </Tooltip>
        ) : (
          <FormControlLabel
            disableTypography
            checked={needSyncTask}
            control={
              <Checkbox
                size="medium"
                checked={needSyncTask}
                onChange={(e) => {
                  setNeedSyncTask(e.target.checked);
                }}
              />
            }
            label={t("syncTask")}
          />
        )}
      </Stack>
      <DialogActions>
        <Button variant="outlined" size="large" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button
          variant="contained"
          size="large"
          id="create-task-btn"
          onClick={
            isDemoSite
              ? () => {
                  localStorage.setItem("honeybeeDemoStatus", "end");
                  window.location.href = "/";
                }
              : createTask
          }
          disabled={isDemoSite ? false : createdTask.loading || !task.title || !task.assignee}
          ref={createMomentBtnRef}
        >
          {createdTask.loading && (
            <CircularProgress color="inherit" size="1rem" className={classes.circularProgress} />
          )}
          {t("createTask")}
        </Button>
      </DialogActions>
      {createdTask.error?.message && <Alert severity="error">{createdTask.error.message}</Alert>}
    </Dialog>
  );
}
