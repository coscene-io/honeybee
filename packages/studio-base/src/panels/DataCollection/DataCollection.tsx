// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Timestamp } from "@bufbuild/protobuf";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import {
  Task,
  UploadTaskDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Palette, Typography, Box } from "@mui/material";
import dayjs from "dayjs";
import { Dispatch, SetStateAction, useCallback, useEffect, useState, memo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useDebouncedCallback } from "use-debounce";
import { useImmer } from "use-immer";

import Log from "@foxglove/log";
import { PanelExtensionContext, SettingsTreeAction } from "@foxglove/studio";
import Stack from "@foxglove/studio-base/components/Stack";
import {
  CallService,
  ProjectSelector,
  TaskRelationInput,
  RecordLabelsInput,
} from "@foxglove/studio-base/panels/DataCollection/components";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

import { useDataCollectionContext } from "./DataCollectionContext";
import { LOG_TIMESTAMP_FORMAT, POLLING_TIMEOUT } from "./constants";
import { useTimer, useLogManager, useProjectData } from "./hooks";
import { defaultConfig, settingsActionReducer, useSettingsTree } from "./settings";
import {
  Config,
  StartCollectionResponse,
  EndCollectionResponse,
  CancelCollectionResponse,
  ButtonType,
  ButtonsState,
  CollectionStage,
  CreateDataCollectionTaskParams,
  ProjectState,
} from "./types";
import {
  handleTaskProgress,
  validateServiceCall,
  handleStartCollectionPreLogic,
  handleServiceResponse,
} from "./utils";

const domainConfig = getDomainConfig();

type Props = {
  context: PanelExtensionContext;
};

const log = Log.getLogger(__dirname);

function DataCollectionContent(
  props: Props & { setColorScheme: Dispatch<SetStateAction<Palette["mode"]>> },
): React.JSX.Element {
  const { context, setColorScheme } = props;
  const { userInfo, consoleApi, deviceLink } = useDataCollectionContext();

  const { t } = useTranslation("dataCollection");

  // 使用自定义 hooks
  const { elapsedTime, formatElapsedTime, startTimer, stopTimer } = useTimer();
  const { logs, logContainerRef, addLog, handleScroll } = useLogManager();
  const {
    projectOptions,
    setProjectOptions,
    recordLabelOptions,
    setRecordLabelOptions,
    syncProjects,
    syncRecordLabels,
  } = useProjectData(consoleApi, userInfo);

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
  const [currentCollectionStage, setCurrentCollectionStage] = useState<CollectionStage>("ready");
  const [collectionStartTime, setCollectionStartTime] = useState<string | undefined>(undefined);

  // 项目相关状态
  const [projectState, setProjectState] = useImmer<ProjectState>({
    projectName: "",
    recordLabels: [],
    currentFocusedTask: undefined,
  });

  // 初始化项目列表
  useEffect(() => {
    void syncProjects().then((listUserProjectsResponse) => {
      if (listUserProjectsResponse) {
        const userProjects = listUserProjectsResponse.userProjects;
        const options = userProjects
          .filter((project) => !project.isArchived)
          .map((project) => ({
            label: project.displayName,
            value: project.name,
          }));
        setProjectOptions(options);
      }
    });
  }, [syncProjects, setProjectOptions]);

  // 当项目变化时获取标签列表
  useEffect(() => {
    if (projectState.projectName !== "") {
      void syncRecordLabels(projectState.projectName);
    } else {
      setRecordLabelOptions([]);
      setProjectState((draft) => {
        draft.recordLabels = [];
      });
    }
  }, [syncRecordLabels, projectState.projectName, setRecordLabelOptions, setProjectState]);

  useEffect(() => {
    if (currentCollectionStage === "collecting") {
      return;
    }

    if (projectState.currentFocusedTask) {
      const taskProjectName = projectState.currentFocusedTask.name.split("/tasks/")[0];

      if (taskProjectName) {
        setProjectState((draft) => {
          draft.projectName = taskProjectName;
        });
      }
    }
  }, [projectState.currentFocusedTask, projectOptions, currentCollectionStage, setProjectState]);

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
    },
    [setConfig],
  );

  const settingsTree = useSettingsTree(config);

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsActionHandler, settingsTree]);

  const createDataCollectionTask = useCallback(
    async ({
      endCollectionResponse,
      recordLabels,
      focusedTask,
      projectName,
    }: CreateDataCollectionTaskParams) => {
      try {
        const { files, record_name, tags } = endCollectionResponse;

        const labels = recordLabels.map((label) => label.displayName);

        const targetProject = await consoleApi.getProject({
          projectName,
        });

        const targetOrg = await consoleApi.getOrg("organizations/current");

        let task_title = record_name;

        if (!record_name) {
          const targetDevice = await consoleApi.getDevice({
            deviceName: `devices/${deviceLink.split("/").pop()}`,
          });

          task_title = `${targetDevice.serialNumber}-${collectionStartTime}`;
        }

        const newTask = new Task({
          assigner: `users/${userInfo.userId}`,
          category: TaskCategoryEnum_TaskCategory.UPLOAD,
          description: "",
          detail: {
            case: "uploadTaskDetail",
            value: new UploadTaskDetail({
              device: `devices/${deviceLink.split("/").pop()}`,
              scanFolders: files,
              endTime: Timestamp.fromDate(new Date()),
              startTime: Timestamp.fromDate(new Date()),
              labels: Array.from(new Set([...tags, ...labels])),
            }),
          },
          title: task_title,
        });

        const response = await consoleApi.createTask_v2({
          parent: projectName,
          task: newTask,
        });

        addLog("+++++++++++++++++++++++++++");
        addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("startUpload")}`);
        addLog("+++++++++++++++++++++++++++");

        addLog(
          `[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("progressLink")}：https://${
            domainConfig.webDomain
          }/${targetOrg.slug}/${targetProject.slug}/devices/execution-history/${response.name
            .split("/")
            .pop()}`,
        );

        addLog(
          `[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("pendingUploadFiles")}: ${files.length}`,
        );

        void handleTaskProgress({
          consoleApi,
          taskName: response.name,
          timeout: POLLING_TIMEOUT,
          addLog,
          t,
          showRecordLink: true,
          targetOrg,
          targetProject,
          focusedTask,
        });
      } catch (err) {
        log.error(err);
        addLog(`[ERROR] ${t("uploadFileFail")}`);
      }
    },
    [collectionStartTime, consoleApi, userInfo.userId, deviceLink, addLog, t],
  );

  const callServiceClicked = useCallback(
    async (buttonType: ButtonType) => {
      // 验证服务调用
      const validationError = validateServiceCall(context, config, addLog, t);
      if (validationError) {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "error",
            value: validationError,
          };
        });
        return;
      }

      try {
        // 处理按钮点击前的逻辑
        await handleStartCollectionPreLogic(
          buttonType,
          projectState.projectName,
          addLog,
          t,
          consoleApi,
          setCurrentCollectionStage,
          setCollectionStartTime,
        );

        // 设置请求状态
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "requesting",
            value: `Calling ${config.buttons[buttonType].serviceName}...`,
          };
        });

        // 调用服务
        const response = (await context.callService!(
          config.buttons[buttonType].serviceName!,
          JSON.parse(config.buttons[buttonType].requestPayload),
        )) as StartCollectionResponse | EndCollectionResponse | CancelCollectionResponse;

        // 设置成功状态
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

        // 处理服务响应
        handleServiceResponse(
          buttonType,
          response,
          addLog,
          t,
          startTimer,
          stopTimer,
          setCurrentCollectionStage,
          createDataCollectionTask,
          projectState,
        );
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
      config,
      addLog,
      t,
      setButtonsState,
      projectState,
      consoleApi,
      startTimer,
      stopTimer,
      createDataCollectionTask,
    ],
  );

  useEffect(() => {
    context.saveState(config);
  }, [config, context]);

  const debouncedTaskFocusedToast = useDebouncedCallback((focusedTask: Task) => {
    toast.success(t("taskFocused", { number: focusedTask.number, ns: "task" }));
  }, 500);

  useEffect(() => {
    context.watch("colorScheme");
    context.watch("extensionData");

    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setColorScheme(renderState.colorScheme ?? "light");

      // 从 extensionData 中获取 focusedTask
      const { focusedTask: extensionFocusedTask } = renderState.extensionData ?? {};
      if (
        extensionFocusedTask !== projectState.currentFocusedTask &&
        currentCollectionStage !== "collecting"
      ) {
        const focusedTask = extensionFocusedTask as Task;
        debouncedTaskFocusedToast(focusedTask);
        setProjectState((draft) => {
          draft.currentFocusedTask = focusedTask;
        });
      }
    };

    return () => {
      context.onRender = undefined;
    };
  }, [
    context,
    setColorScheme,
    projectState.currentFocusedTask,
    currentCollectionStage,
    t,
    setProjectState,
    debouncedTaskFocusedToast,
  ]);

  // Indicate render is complete - the effect runs after the dom is updated
  useEffect(() => {
    renderDone();
  }, [renderDone]);

  return (
    <Stack fullHeight>
      <Stack flex="auto" gap={1} padding={1.5}>
        <Typography variant="caption" noWrap>
          {t("dataSaveLocation")}
        </Typography>
        <Box gap={1} display="flex" border="1px solid" overflow="auto" borderRadius={1} padding={1}>
          <ProjectSelector
            projectName={projectState.projectName}
            projectOptions={projectOptions}
            disabled={currentCollectionStage === "collecting"}
            onProjectChange={(projectName) => {
              setProjectState((draft) => {
                draft.projectName = projectName;
              });
            }}
            onClearFocusedTask={() => {
              setProjectState((draft) => {
                draft.currentFocusedTask = undefined;
              });
            }}
            label={t("projectName")}
          />

          <TaskRelationInput
            currentFocusedTask={projectState.currentFocusedTask}
            currentCollectionStage={currentCollectionStage}
            onClearTask={() => {
              setProjectState((draft) => {
                draft.currentFocusedTask = undefined;
              });
            }}
            t={t}
          />

          <RecordLabelsInput
            recordLabels={projectState.recordLabels}
            recordLabelOptions={recordLabelOptions}
            disabled={currentCollectionStage === "collecting"}
            onLabelsChange={(labels) => {
              setProjectState((draft) => {
                draft.recordLabels = labels;
              });
            }}
            t={t}
          />
        </Box>
      </Stack>
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
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            height: 0,
            border: "1px solid",
            borderRadius: 4,
            overflow: "auto",
            padding: 8,
          }}
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
        </div>
      </Stack>
    </Stack>
  );
}

export const DataCollection = memo(function DataCollection({ context }: Props): React.JSX.Element {
  const [colorScheme, setColorScheme] = useState<Palette["mode"]>("light");
  const { t } = useTranslation("dataCollection");
  const { panelState } = useDataCollectionContext();

  // Wrapper component with ThemeProvider so useStyles in the panel receives the right theme.
  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      {panelState === "SOURCE_TYPE_NOT_SUPPORTED" && (
        <Stack fullHeight justifyContent="center" alignItems="center">
          {t("onlySupportRealTimeVisualization")}
        </Stack>
      )}
      {panelState === "NOT_LOGIN" && (
        <Stack fullHeight justifyContent="center" alignItems="center">
          {t("pleaseLoginToUseThisPanel")}
        </Stack>
      )}
      {panelState === "LOADING" && (
        <Stack fullHeight justifyContent="center" alignItems="center">
          {t("loading")}
        </Stack>
      )}
      {panelState === "NOMAL" && (
        <DataCollectionContent setColorScheme={setColorScheme} context={context} />
      )}
    </ThemeProvider>
  );
});
