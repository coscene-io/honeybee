// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Timestamp } from "@bufbuild/protobuf";
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import {
  Task,
  UploadTaskDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Palette, Typography } from "@mui/material";
import { TFunction } from "i18next";
import { Dispatch, SetStateAction, useCallback, useEffect, useState, useRef } from "react";
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
  timeout,
  addLog,
  t,
  showRecordLink = true,
  targetOrg,
  targetProject,
}: {
  consoleApi: ConsoleApi;
  taskName: string;
  timeout: number;
  addLog: (log: string) => void;
  t: TFunction<"dataCollection">;
  showRecordLink: boolean;
  targetOrg: Organization;
  targetProject: Project;
}): Promise<void> {
  const task = await consoleApi.getTask({ taskName });

  const uploadedFiles = Number(task.tags.uploadedFiles ?? 0);
  const totalFiles = Number(task.tags.totalFiles);
  const porgressText =
    !Number.isNaN(uploadedFiles) && !Number.isNaN(totalFiles) && totalFiles > 0
      ? ` ${uploadedFiles}/${totalFiles}`
      : "";

  let needShowRecordLink = showRecordLink;

  if (task.tags.recordName != undefined && showRecordLink) {
    addLog(
      `[${new Date().toISOString()}] ${t("saveToRecord")}：${window.location.origin}/${
        targetOrg.slug
      }/${targetProject.slug}/records/${task.tags.recordName.split("/").pop()}`,
    );
    needShowRecordLink = false;
  }

  switch (task.state) {
    case TaskStateEnum_TaskState.FAILED:
    case TaskStateEnum_TaskState.SUCCEEDED:
      if (totalFiles === 0) {
        addLog(`[ERROR] ${t("errorNoFilesMatched")}`);
      } else if (uploadedFiles < totalFiles) {
        addLog(`[ERROR] ${t("checkFileDeleted")}`);
      } else {
        addLog("+++++++++++++++++++++++++++");
        addLog(`[${new Date().toISOString()}] ${t("fileUploaded")} ${porgressText}`);
        addLog("+++++++++++++++++++++++++++");
      }
      break;

    case TaskStateEnum_TaskState.PENDING:
      addLog(`[${new Date().toISOString()}] ${t("taskStatePending")}`);
      setTimeout(() => {
        void handleTaskProgress({
          consoleApi,
          taskName,
          timeout,
          addLog,
          t,
          showRecordLink: needShowRecordLink,
          targetOrg,
          targetProject,
        });
      }, timeout);
      break;

    case TaskStateEnum_TaskState.PROCESSING:
      addLog(`[${new Date().toISOString()}] ${t("processing")} ${porgressText}`);
      setTimeout(() => {
        void handleTaskProgress({
          consoleApi,
          taskName,
          timeout,
          addLog,
          t,
          showRecordLink: needShowRecordLink,
          targetOrg,
          targetProject,
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
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout>();

  const addLog = useCallback(
    (newLog: string) => {
      setLogs((prevLogs) => [...prevLogs, newLog]);
    },
    [setLogs],
  );

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

  const formatElapsedTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const startTimer = useCallback(() => {
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    setElapsedTime(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const createDataCollectionTask = useCallback(
    async ({ endCollectionResponse }: { endCollectionResponse: EndCollectionResponse }) => {
      try {
        const { files, record_name, tags } = endCollectionResponse;
        const { recordLabels } = taskInfoSnapshot ?? {};

        const targetProject = await consoleApi.getProject({
          projectName: taskInfoSnapshot?.project.name ?? "",
        });

        const targetOrg = await consoleApi.getOrg("organizations/current");

        let task_title = record_name;

        if (!record_name) {
          const targetDevice = await consoleApi.getDevice({
            deviceName: `devices/${deviceLink.split("/").pop()}`,
          });

          task_title = `${targetDevice.serialNumber}-${taskInfoSnapshot?.startTime}`;
        }

        const newTask = new Task({
          category: TaskCategoryEnum_TaskCategory.UPLOAD,
          description: "",
          detail: {
            case: "uploadTaskDetail",
            value: new UploadTaskDetail({
              device: `devices/${deviceLink.split("/").pop()}`,
              scanFolders: files,
              endTime: Timestamp.fromDate(new Date()),
              startTime: Timestamp.fromDate(new Date()),
              labels: Array.from(new Set([...tags, ...(recordLabels ?? [])])),
            }),
          },
          title: task_title,
        });

        const response = await consoleApi.createTask_v2({
          parent: taskInfoSnapshot?.project.name ?? "",
          task: newTask,
        });

        addLog("+++++++++++++++++++++++++++");
        addLog(`[${new Date().toISOString()}] ${t("startUpload")}`);
        addLog("+++++++++++++++++++++++++++");

        addLog(
          `[${new Date().toISOString()}] ${t("progressLink")}：${window.location.origin}/${
            targetOrg.slug
          }/${targetProject.slug}/tasks/automated-data-collection-tasks/${response.name
            .split("/")
            .pop()}`,
        );

        addLog(`[${new Date().toISOString()}] ${t("pendingUploadFiles")}: ${files.length}`);

        void handleTaskProgress({
          consoleApi,
          taskName: response.name,
          timeout: 3000,
          addLog,
          t,
          showRecordLink: true,
          targetOrg,
          targetProject,
        });
      } catch (err) {
        log.error(err);
        addLog(`[ERROR] ${t("uploadFileFail")}`);
      }
    },
    [taskInfoSnapshot, consoleApi, deviceLink, addLog, t],
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

      if (Object.entries(config.buttons).some(([, button]) => button.serviceName == undefined)) {
        addLog("[ERROR] " + t("configureService"));
        return;
      }

      switch (buttonType) {
        case "startCollection": {
          if (config.projectName == undefined) {
            addLog("[ERROR] " + t("projectNameNotSet"));
            return;
          }
          addLog("+++++++++++++++++++++++++++");
          addLog(`[${new Date().toISOString()}] ${t("startCollection")}`);
          addLog("+++++++++++++++++++++++++++");

          const project = await consoleApi.getProject({
            projectName: config.projectName,
          });

          await consoleApi.setApiBaseInfo({
            projectId: project.name.split("/").pop(),
            projectSlug: project.slug,
            projectDisplayName: project.displayName,
            warehouseId: project.name.split("warehouses/")[1]?.split("/")[0],
          });

          if (!consoleApi.createTask_v2.permission()) {
            addLog("[ERROR] " + t("noPermissionToCreateTask"));
            return;
          }
          setCurrentCollectionStage("collecting");
          setTaskInfoSnapshot({
            project,
            recordLabels: config.recordLabels ?? [],
            startTime: new Date().toISOString(),
          });
          startTimer();
          break;
        }

        case "endCollection":
          addLog(`[${new Date().toISOString()}] ${t("endingCollection")}`);
          break;

        case "cancelCollection":
          addLog(`[${new Date().toISOString()}] ${t("cancellingCollection")}`);
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
              addLog(`[${new Date().toISOString()}] ${t("startCollectionSuccess")}`);
            } else {
              addLog(`[ERROR] ${t("startCollectionFail")}: ${response.message}`);
              setCurrentCollectionStage("ready");
              stopTimer();
            }
            break;

          case "endCollection":
            if (response.success) {
              addLog("+++++++++++++++++++++++++++");
              addLog(`[${new Date().toISOString()}] ${t("endCollectionSuccess")}`);
              addLog("+++++++++++++++++++++++++++");
              void createDataCollectionTask({
                endCollectionResponse: response as EndCollectionResponse,
              });
              setCurrentCollectionStage("ready");
              stopTimer();
            } else {
              addLog(`[ERROR] ${t("endCollectionFail")}: ${response.message}`);
            }
            break;

          case "cancelCollection":
            if (response.success) {
              addLog("+++++++++++++++++++++++++++");
              addLog(`[${new Date().toISOString()}] ${t("cancelCollectionSuccess")}`);
              addLog("+++++++++++++++++++++++++++");
              setCurrentCollectionStage("ready");
              stopTimer();
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
        stopTimer();
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
      consoleApi,
      createDataCollectionTask,
      startTimer,
      stopTimer,
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
            elapsedTime={key === "endCollection" ? formatElapsedTime(elapsedTime) : undefined}
          />
        ))}
      </Stack>

      {/* log */}
      <Stack flex="auto" gap={1} padding={1.5} fullHeight>
        <Typography variant="caption" noWrap>
          {t("collectionLog")}
        </Typography>
        <Stack
          flex="auto"
          style={{ height: 0, border: "1px solid", borderRadius: 4 }}
          overflow="auto"
          padding={1}
        >
          {logs.map((logLine, index) => {
            return (
              <Typography
                variant="caption"
                noWrap
                key={index}
                color={logLine.startsWith("[ERROR]") ? "error" : undefined}
                minHeight={20}
              >
                {logLine.split(/(https?:\/\/[^\s]+)/).map((part, i) => {
                  if (part.match(/^https?:\/\//)) {
                    return (
                      <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "inherit", textDecoration: "underline" }}
                      >
                        {part}
                      </a>
                    );
                  }
                  return part;
                })}
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
