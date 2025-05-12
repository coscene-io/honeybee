// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Palette } from "@mui/material";
import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
import { useImmer } from "use-immer";

import Log from "@foxglove/log";
import { PanelExtensionContext, SettingsTreeAction } from "@foxglove/studio";
import Stack from "@foxglove/studio-base/components/Stack";
import { CallService } from "@foxglove/studio-base/panels/DataCollection/CallService";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { defaultConfig, settingsActionReducer, useSettingsTree } from "./settings";
import { Config, ButtonType, ButtonsState } from "./types";

type Props = {
  context: PanelExtensionContext;
};

const log = Log.getLogger(__dirname);

function DataCollectionContent(
  props: Props & { setColorScheme: Dispatch<SetStateAction<Palette["mode"]>> },
): React.JSX.Element {
  const { context, setColorScheme } = props;

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

      try {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "requesting",
            value: `Calling ${config.serviceName}...`,
          };
        });
        const response = await context.callService(
          config.serviceName!,
          JSON.parse(config.buttons[buttonType].requestPayload),
        );
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
      } catch (err) {
        setButtonsState((draft) => {
          draft[buttonType] = {
            status: "error",
            value: (err as Error).message,
          };
        });
        log.error(err);
      }
    },
    [context, setButtonsState, config.serviceName, config.buttons],
  );

  useEffect(() => {
    context.saveState(config);
    context.setDefaultPanelTitle(
      config.serviceName ? `Call service ${config.serviceName}` : undefined,
    );
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
    <Stack>
      {/* call service button */}
      <Stack>
        {Object.entries(config.buttons).map(([key]) => (
          <CallService
            key={key}
            type={key as ButtonType}
            config={config}
            buttonsState={buttonsState}
            supportCallService={context.callService != undefined}
            callServiceClicked={callServiceClicked}
            setConfig={setConfig}
          />
        ))}
      </Stack>

      {/* log */}
      <Stack></Stack>
    </Stack>
  );
}

export function DataCollection({ context }: Props): React.JSX.Element {
  const [colorScheme, setColorScheme] = useState<Palette["mode"]>("light");
  // Wrapper component with ThemeProvider so useStyles in the panel receives the right theme.
  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <DataCollectionContent context={context} setColorScheme={setColorScheme} />
    </ThemeProvider>
  );
}
