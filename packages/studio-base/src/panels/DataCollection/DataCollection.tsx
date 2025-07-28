// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Timestamp } from "@bufbuild/protobuf";
import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import {
  Task,
  UploadTaskDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Clear as ClearIcon } from "@mui/icons-material";
import {
  Palette,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Box,
  SelectChangeEvent,
  IconButton,
} from "@mui/material";
import dayjs from "dayjs";
import { TFunction } from "i18next";
import { Dispatch, SetStateAction, useCallback, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { useImmer } from "use-immer";

import Log from "@foxglove/log";
import { PanelExtensionContext, SettingsTreeAction } from "@foxglove/studio";
import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";
import Stack from "@foxglove/studio-base/components/Stack";
import { ConsoleApi } from "@foxglove/studio-base/index";
import { CallService } from "@foxglove/studio-base/panels/DataCollection/CallService";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { useDataCollectionContext } from "./DataCollectionContext";
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
  context: PanelExtensionContext;
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
      `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("saveToRecord")}：https://${
        APP_CONFIG.DOMAIN_CONFIG.default?.webDomain ?? ""
      }/${targetOrg.slug}/${targetProject.slug}/records/${task.tags.recordName.split("/").pop()}`,
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
        addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("fileUploaded")} ${porgressText}`);
        addLog("+++++++++++++++++++++++++++");
      }
      break;

    case TaskStateEnum_TaskState.PENDING:
      addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("taskStatePending")}`);
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
      addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("processing")} ${porgressText}`);
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
  const { context, setColorScheme } = props;
  const { userInfo, consoleApi, deviceLink, focusedTask } = useDataCollectionContext();

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
  const logContainerRef = useRef<HTMLDivElement>(ReactNull);
  const [isUserScrolling, setIsUserScrolling] = useState<boolean>(false);

  // 独立的 projectName 和 recordLabels 状态
  const [projectName, setProjectName] = useState<string>("");
  const [recordLabels, setRecordLabels] = useState<Label[]>([]);
  // const [taskRelation, setTaskRelation] = useState<string>("hello");
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);
  const [recordLabelOptions, setRecordLabelOptions] = useState<Label[]>([]);
  const [currentFocusedTask, setCurrentFocusedTask] = useState<Task | undefined>(undefined);

  const MAX_PROJECTS_PAGE_SIZE = 999;

  // 获取项目列表
  const [, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo.userId;

    if (userId) {
      try {
        return await consoleApi.listUserProjects({
          userId,
          pageSize: MAX_PROJECTS_PAGE_SIZE,
          currentPage: 0,
        });
      } catch (error) {
        console.error("error", error);
      }
    }

    return undefined;
  }, [consoleApi, userInfo.userId]);

  // 获取标签列表
  const [, syncRecordLabels] = useAsyncFn(async () => {
    if (projectName) {
      try {
        const listLabelsResponse = await consoleApi.listLabels({
          warehouseId: projectName.split("warehouses/")[1]?.split("/")[0] ?? "",
          projectId: projectName.split("/").pop() ?? "",
          pageSize: MAX_PROJECTS_PAGE_SIZE,
        });
        const labels = listLabelsResponse.labels;
        setRecordLabelOptions(labels);
        return listLabelsResponse;
      } catch (error) {
        console.error("error", error);
      }
    }

    return undefined;
  }, [consoleApi, projectName]);

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
  }, [syncProjects]);

  // 当项目变化时获取标签列表
  useEffect(() => {
    setCurrentFocusedTask(undefined);
    if (projectName) {
      void syncRecordLabels();
    } else {
      setRecordLabelOptions([]);
      setRecordLabels([]);
    }
  }, [syncRecordLabels, projectName]);

  useEffect(() => {
    if (currentCollectionStage === "collecting") {
      return;
    }

    if (focusedTask) {
      setCurrentFocusedTask(focusedTask);

      const taskProjectName = focusedTask.name.split("/tasks/")[0];

      if (taskProjectName) {
        setProjectName(taskProjectName);
      }
    } else {
      setCurrentFocusedTask(undefined);
    }
  }, [focusedTask, projectOptions, currentCollectionStage]);

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

  const settingsTree = useSettingsTree(config);

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
        addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("startUpload")}`);
        addLog("+++++++++++++++++++++++++++");

        try {
          await consoleApi.linkTasks({
            project: taskInfoSnapshot?.project.name ?? "",
            linkTasks: [
              {
                task: focusedTask?.name ?? "",
                target: { value: response.name, case: "targetTask" },
              },
            ],
          });
        } catch (linkError) {
          // 如果链接任务失败，记录错误但不阻止整个流程
          console.error("Failed to link tasks:", linkError);
          addLog(
            `[WARNING] ${t("taskLinkFailed")}: ${
              linkError instanceof Error ? linkError.message : String(linkError)
            }`,
          );
        }

        addLog(
          `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("autoLinkedTask")}：https://${
            APP_CONFIG.DOMAIN_CONFIG.default?.webDomain ?? ""
          }/${targetOrg.slug}/${targetProject.slug}/tasks/general-tasks/${currentFocusedTask?.name
            .split("/")
            .pop()}`,
        );

        addLog(
          `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("progressLink")}：https://${
            APP_CONFIG.DOMAIN_CONFIG.default?.webDomain ?? ""
          }/${targetOrg.slug}/${targetProject.slug}/devices/execution-history/${response.name
            .split("/")
            .pop()}`,
        );

        addLog(
          `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("pendingUploadFiles")}: ${files.length}`,
        );

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
    [
      taskInfoSnapshot,
      consoleApi,
      userInfo.userId,
      deviceLink,
      addLog,
      t,
      focusedTask?.name,
      currentFocusedTask?.name,
    ],
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

      if (Object.entries(config.buttons).some(([, button]) => !button.serviceName)) {
        addLog("[ERROR] " + t("configureService"));
        return;
      }

      switch (buttonType) {
        case "startCollection": {
          if (!projectName) {
            addLog("[ERROR] " + t("projectNameNotSet"));
            return;
          }
          addLog("+++++++++++++++++++++++++++");
          addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("startCollection")}`);
          addLog("+++++++++++++++++++++++++++");

          const project = await consoleApi.getProject({
            projectName,
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
            recordLabels: recordLabels.map((label) => label.displayName),
            startTime: dayjs().format("YYYY-MM-DD HH:mm:ss"),
          });
          break;
        }

        case "endCollection":
          addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("endingCollection")}`);
          break;

        case "cancelCollection":
          addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("cancellingCollection")}`);
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
              addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("startCollectionSuccess")}`);
              startTimer();
            } else {
              addLog(`[ERROR] ${t("startCollectionFail")}: ${response.message}`);
              setCurrentCollectionStage("ready");
              stopTimer();
            }
            break;

          case "endCollection":
            if (response.success) {
              addLog("+++++++++++++++++++++++++++");
              addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("endCollectionSuccess")}`);
              addLog("+++++++++++++++++++++++++++");
              setCurrentCollectionStage("ready");
              stopTimer();
              if ("type" in response && response.type === "SKIP_CAPTURE") {
                return;
              }
              void createDataCollectionTask({
                endCollectionResponse: response as EndCollectionResponse,
              });
            } else {
              addLog(`[ERROR] ${t("endCollectionFail")}: ${response.message}`);
            }
            break;

          case "cancelCollection":
            if (response.success) {
              addLog("+++++++++++++++++++++++++++");
              addLog(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${t("cancelCollectionSuccess")}`);
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
      projectName,
      recordLabels,
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

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (logContainerRef.current && !isUserScrolling) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [isUserScrolling]);

  // 检测用户是否手动滚动
  const handleScroll = useCallback(() => {
    if (logContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5; // 5px 容差
      setIsUserScrolling(!isAtBottom);
    }
  }, []);

  // 当日志更新时自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  return (
    <Stack fullHeight>
      <Stack flex="auto" gap={1} padding={1.5}>
        <Typography variant="caption" noWrap>
          {t("dataSaveLocation")}
        </Typography>
        <Box gap={1} display="flex" border="1px solid" overflow="auto" borderRadius={1} padding={1}>
          {/* projectName */}
          <Box minWidth={200}>
            <FormControl fullWidth size="small">
              <InputLabel id="project-select-label" required>
                {t("projectName")}
              </InputLabel>
              <Select
                labelId="project-select-label"
                id="project-select"
                value={projectName}
                label={t("projectName")}
                onChange={(event: SelectChangeEvent) => {
                  setProjectName(event.target.value);
                }}
              >
                {projectOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* taskRelation */}
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
                        onClick={() => {
                          setCurrentFocusedTask(undefined);
                        }}
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

          {/* recordLabels */}
          <Box minWidth={200}>
            <FormControl fullWidth size="small">
              <InputLabel id="record-labels-select-label">{t("recordLabels")}</InputLabel>
              <RecordLabelSelector
                value={recordLabels.map((label) => label.name)}
                options={recordLabelOptions}
                onChange={(_, newValue) => {
                  setRecordLabels(newValue);
                }}
                placeholder={t("recordLabels")}
              />
            </FormControl>
          </Box>
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

export function DataCollection({ context }: Props): React.JSX.Element {
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
}
