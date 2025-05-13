// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Timestamp } from "@bufbuild/protobuf";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import {
  Task,
  UploadTaskDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Palette, Typography } from "@mui/material";
import { TFunction } from "i18next";
import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useImmer } from "use-immer";

import Log from "@foxglove/log";
import { PanelExtensionContext, SettingsTreeAction } from "@foxglove/studio";
import Stack from "@foxglove/studio-base/components/Stack";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";
import { CallService } from "@foxglove/studio-base/panels/DataCollection/CallService";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { defaultConfig, settingsActionReducer, useSettingsTree } from "./settings";
import {
  Config,
  StartCollectionResponse,
  EndCollectionResponse,
  CancelCollectionResponse,
  ButtonType,
  ButtonsState,
  CollectionStage,
  TaskInfoSnapshot,
} from "./types";

type Props = {
  deviceLink: string;
  context: PanelExtensionContext;
  userInfo: User;
  consoleApi: ConsoleApi;
};

const log = Log.getLogger(__dirname);

async function handleTaskProgress({
  consoleApi,
  taskName,
  lastUploadedFiles,
  timeout,
  addLog,
  t,
}: {
  consoleApi: ConsoleApi;
  taskName: string;
  lastUploadedFiles: number;
  timeout: number;
  addLog: (log: string) => void;
  t: TFunction<"dataCollection">;
}): Promise<void> {
  const task = await consoleApi.getTask({ taskName });

  const uploadedFiles = Number(task.tags.uploadedFiles ?? 0);
  const totalFiles = Number(task.tags.totalFiles);
  const porgressText =
    !Number.isNaN(uploadedFiles) && !Number.isNaN(totalFiles) && totalFiles > 0
      ? ` ${uploadedFiles}/${totalFiles}`
      : "";

  switch (task.state) {
    case TaskStateEnum_TaskState.FAILED:
    case TaskStateEnum_TaskState.SUCCEEDED:
      if (totalFiles === 0) {
        addLog(`[ERROR] ${t("errorNoFilesMatched")}`);
      } else if (uploadedFiles < totalFiles) {
        addLog(`[ERROR] ${t("checkFileDeleted")}`);
      } else {
        addLog(`${t("fileUploaded")} ${porgressText}`);
      }
      break;

    case TaskStateEnum_TaskState.PROCESSING:
      if (uploadedFiles > lastUploadedFiles) {
        addLog(`${t("processing")} ${porgressText}`);
      }
      setTimeout(() => {
        void handleTaskProgress({
          consoleApi,
          taskName,
          lastUploadedFiles: uploadedFiles,
          timeout,
          addLog,
          t,
        });
      }, timeout);
      break;

    case TaskStateEnum_TaskState.CANCELLING:
    case TaskStateEnum_TaskState.CANCELLED:
      addLog(`[ERROR] ${t("cancelled")}`);
      break;
  }
}

function DataCollectionContent(
  props: Props & { setColorScheme: Dispatch<SetStateAction<Palette["mode"]>> },
): React.JSX.Element {
  const { context, setColorScheme, userInfo, consoleApi, deviceLink } = props;

  const { t } = useTranslation("dataCollection");

  // panel extensions must notify when they've completed rendering
  // onRender will setRenderDone to a done callback which we can invoke after we've rendered
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  const [buttonsState, setButtonsState] = useImmer<ButtonsState>({
    startCollection: undefined,
    endCollection: undefined,
    cancelCollection: undefined,
  });
  const [config, setConfig] = useImmer<Config>(() => ({
    ...defaultConfig,
    ...(context.initialState as Partial<Config>),
  }));
  const [logs, setLogs] = useState<string[]>([]);
  const [currentCollectionStage, setCurrentCollectionStage] = useState<CollectionStage>("ready");
  const [taskInfoSnapshot, setTaskInfoSnapshot] = useState<TaskInfoSnapshot | undefined>(undefined);

  const addLog = useCallback(
    (newLog: string) => {
      setLogs((prevLogs) => [...prevLogs, newLog]);
    },
    [setLogs],
  );

  useEffect(() => {
    if (context.callService == undefined) {
      addLog("[ERROR] " + t("connectToDataSource"));
    }
    if (Object.entries(config.buttons).some(([, button]) => button.serviceName == undefined)) {
      addLog("[ERROR] " + t("configureService"));
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
  }, [addLog, config.buttons, context.callService, t]);

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
    },
    [setConfig],
  );

  const settingsTree = useSettingsTree(config, userInfo, consoleApi);
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsActionHandler, settingsTree]);

  const createDataCollectionTask = useCallback(
    async ({ endCollectionResponse }: { endCollectionResponse: EndCollectionResponse }) => {
      const { files, recordName } = endCollectionResponse;

      const targetProject = await consoleApi.getProject({
        projectName: taskInfoSnapshot?.projectName ?? "",
      });

      const targetOrg = await consoleApi.getOrg("organizations/current");

      const newTask = new Task({
        assigner: `users/current`,
        category: TaskCategoryEnum_TaskCategory.UPLOAD,
        description: "",
        detail: {
          case: "uploadTaskDetail",
          value: new UploadTaskDetail({
            device: `devices/${deviceLink.split("/").pop()}`,
            scanFolders: files,
            endTime: Timestamp.fromDate(new Date()),
            startTime: Timestamp.fromDate(new Date()),
          }),
        },
        title: recordName ?? `${deviceLink.split("/").pop()}-${taskInfoSnapshot?.startTime}`,
      });

      const response = await consoleApi.createTask_v2({
        parent: taskInfoSnapshot?.projectName ?? "",
        task: newTask,
      });

      addLog(t("startUpload"));

      addLog(
        `${t("saveToRecord")}：${window.location.origin}/${targetOrg.slug}/${
          targetProject.slug
        }/records/${response.tags.recordName}`,
      );

      addLog(
        `${t("progressLink")}：${window.location.origin}/${targetOrg.slug}/${
          targetProject.slug
        }/tasks/automated-data-collection-tasks/${response.name.split("/").pop()}`,
      );

      void handleTaskProgress({
        consoleApi,
        taskName: response.name,
        lastUploadedFiles: 0,
        timeout: 3000,
        addLog,
        t,
      });
    },
    [consoleApi, taskInfoSnapshot?.projectName, taskInfoSnapshot?.startTime, deviceLink, addLog, t],
  );

  const callServiceClicked = useCallback(
    async (buttonType: ButtonType) => {
      if (!context.callService) {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "error",
            value: "The data source does not allow calling services",
          };
        });
        return;
      }

      switch (buttonType) {
        case "startCollection":
          setCurrentCollectionStage("collecting");
          addLog(t("startCollection"));
          if (config.projectName == undefined) {
            addLog("[ERROR] " + t("projectNameNotSet"));
            return;
          }
          if (!consoleApi.createTask_v2.permission()) {
            addLog("[ERROR] " + t("noPermissionToCreateTask"));
            return;
          }
          setTaskInfoSnapshot({
            projectName: config.projectName,
            recordLabels: config.recordLabels ?? [],
            startTime: new Date().toISOString(),
          });
          break;

        case "endCollection":
          addLog(t("endingCollection"));
          break;

        case "cancelCollection":
          addLog(t("cancellingCollection"));
          break;

        default:
          addLog(`[ERROR] ${t("unknownButtonType")}: ${buttonType}`);
          return;
      }

      try {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "requesting",
            value: `Calling ${config.buttons[buttonType].serviceName}...`,
          };
        });

        const response = (await context.callService(
          config.buttons[buttonType].serviceName!,
          JSON.parse(config.buttons[buttonType].requestPayload),
        )) as StartCollectionResponse | EndCollectionResponse | CancelCollectionResponse;

        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "success",
            value:
              JSON.stringify(
                response,
                // handle stringify BigInt correctly
                (_key, value) => (typeof value === "bigint" ? value.toString() : value),
                2,
              ) ?? "",
          };
        });

        switch (buttonType) {
          case "startCollection":
            if (response.success) {
              addLog(t("startCollectionSuccess"));
            } else {
              addLog(`[ERROR] ${t("startCollectionFail")}: ${response.message}`);
              setCurrentCollectionStage("ready");
            }
            break;

          case "endCollection":
            if (response.success) {
              addLog(t("endCollectionSuccess"));
              void createDataCollectionTask({
                endCollectionResponse: response as EndCollectionResponse,
              });
              setCurrentCollectionStage("ready");
            } else {
              addLog(`[ERROR] ${t("endCollectionFail")}: ${response.message}`);
            }
            break;

          case "cancelCollection":
            if (response.success) {
              addLog(t("cancelCollectionSuccess"));
              setCurrentCollectionStage("ready");
            } else {
              addLog(`[ERROR] ${t("cancelCollectionFail")}: ${response.message}`);
            }
            break;

          default:
            addLog(`[ERROR] ${t("unknownButtonType")}: ${buttonType}`);
            return;
        }
      } catch (err) {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "error",
            value: (err as Error).message,
          };
        });
        log.error(err);

        addLog(`[ERROR] ${(err as Error).message}`);
        setCurrentCollectionStage("ready");
      }
    },
    [
      context,
      setButtonsState,
      addLog,
      t,
      config.projectName,
      config.recordLabels,
      config.buttons,
      consoleApi.createTask_v2,
      createDataCollectionTask,
    ],
  );

  useEffect(() => {
    context.saveState(config);
  }, [config, context]);

  useEffect(() => {
    context.watch("colorScheme");

    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setColorScheme(renderState.colorScheme ?? "light");
    };

    return () => {
      context.onRender = undefined;
    };
  }, [context, setColorScheme]);

  // Indicate render is complete - the effect runs after the dom is updated
  useEffect(() => {
    renderDone();
  }, [renderDone]);

  return (
    <Stack fullHeight>
      {/* call service button */}
      <Stack direction="row" gap={1}>
        {Object.entries(config.buttons).map(([key]) => (
          <CallService
            key={key}
            type={key as ButtonType}
            config={config}
            buttonsState={buttonsState}
            supportCallService={
              context.callService != undefined &&
              ((key === "startCollection" && currentCollectionStage === "ready") ||
                (key === "endCollection" && currentCollectionStage === "collecting") ||
                (key === "cancelCollection" && currentCollectionStage === "collecting"))
            }
            callServiceClicked={callServiceClicked}
            setConfig={setConfig}
          />
        ))}
      </Stack>

      {/* log */}
      <Stack flex="auto" gap={1} padding={1.5} fullHeight>
        <Typography variant="caption" noWrap>
          {t("collectionLog")}
        </Typography>
        <Stack flex="auto" style={{ height: 0 }}>
          {logs.map((logLine, index) => {
            return (
              <Typography
                variant="caption"
                noWrap
                key={index}
                color={logLine.startsWith("[ERROR]") ? "error" : undefined}
              >
                {logLine}
              </Typography>
            );
          })}
        </Stack>
      </Stack>
    </Stack>
  );
}

export function DataCollection({
  deviceLink,
  context,
  userInfo,
  consoleApi,
}: Props): React.JSX.Element {
  const [colorScheme, setColorScheme] = useState<Palette["mode"]>("light");

  // Wrapper component with ThemeProvider so useStyles in the panel receives the right theme.
  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <DataCollectionContent
        deviceLink={deviceLink}
        setColorScheme={setColorScheme}
        context={context}
        userInfo={userInfo}
        consoleApi={consoleApi}
      />
    </ThemeProvider>
  );
}
