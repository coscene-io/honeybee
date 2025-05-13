// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
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
import { Palette, Typography } from "@mui/material";
import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
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
  context: PanelExtensionContext;
  userInfo: User;
  consoleApi: ConsoleApi;
};

const log = Log.getLogger(__dirname);

function DataCollectionContent(
  props: Props & { setColorScheme: Dispatch<SetStateAction<Palette["mode"]>> },
): React.JSX.Element {
  const { context, setColorScheme, userInfo, consoleApi } = props;

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
      addLog("[ERROR] Connect to a data source that supports calling services");
    }
    if (Object.entries(config.buttons).some(([, button]) => button.serviceName == undefined)) {
      addLog("[ERROR] Configure a service in the panel settings");
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
  }, [addLog, config.buttons, context.callService]);

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

  // const createDataCollectionTask = useCallback(
  //   async ({ scanFolders, taskName }: { scanFolders: string[]; taskName: string }) => {
  //     const newTask = new Task({
  //       assigner: `users/current`,
  //       category: TaskCategoryEnum_TaskCategory.UPLOAD,
  //       description: "",
  //       detail: {
  //         case: "uploadTaskDetail",
  //         value: new UploadTaskDetail({
  //           device: "",
  //           scanFolders,
  //           endTime: Timestamp.fromDate(new Date()),
  //           startTime: Timestamp.fromDate(new Date()),
  //         }),
  //       },
  //       title: taskName,
  //     });
  //   },
  //   [context, config.buttons, buttonType],
  // );

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
          addLog("start collection");
          if (config.projectName == undefined) {
            addLog("[ERROR] Project name is not set");
            return;
          }
          setTaskInfoSnapshot({
            projectName: config.projectName,
            recordLabels: config.recordLabels ?? [],
          });
          break;

        case "endCollection":
          addLog("end collection");
          break;

        case "cancelCollection":
          addLog("cancel collection");
          break;

        default:
          addLog(`[ERROR] Unknown button type: ${buttonType}`);
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
              addLog("start collection success");
            } else {
              addLog(`[ERROR] start collection fail ${response.message}`);
              setCurrentCollectionStage("ready");
            }
            break;

          case "endCollection":
            if (response.success) {
              addLog("end collection success");
              // void createDataCollectionTask({
              //   projectName: taskInfoSnapshot?.projectName ?? "",
              //   recordLabels: Array.from(taskInfoSnapshot?.recordLabels ?? []),
              //   endCollectionResponse: response as EndCollectionResponse,
              // });
              setCurrentCollectionStage("ready");
            } else {
              addLog(`[ERROR] end collection fail ${response.message}`);
            }
            break;

          case "cancelCollection":
            if (response.success) {
              addLog("cancel collection success");
              setCurrentCollectionStage("ready");
            } else {
              addLog(`[ERROR] cancel collection fail ${response.message}`);
            }
            break;

          default:
            addLog(`[ERROR] Unknown button type: ${buttonType}`);
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
    [context, setButtonsState, addLog, config.projectName, config.recordLabels, config.buttons],
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
          logs
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

export function DataCollection({ context, userInfo, consoleApi }: Props): React.JSX.Element {
  const [colorScheme, setColorScheme] = useState<Palette["mode"]>("light");

  // Wrapper component with ThemeProvider so useStyles in the panel receives the right theme.
  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <DataCollectionContent
        setColorScheme={setColorScheme}
        context={context}
        userInfo={userInfo}
        consoleApi={consoleApi}
      />
    </ThemeProvider>
  );
}
