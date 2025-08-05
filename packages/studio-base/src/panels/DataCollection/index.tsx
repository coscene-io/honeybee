// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo } from "react";
import ReactDOM from "react-dom";

import { useCrash } from "@foxglove/hooks";
import { PanelExtensionContext } from "@foxglove/studio";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Panel from "@foxglove/studio-base/components/Panel";
import { PanelExtensionAdapter } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { DataCollection } from "./DataCollection";
import { DataCollectionContextType, DataCollectionProvider } from "./DataCollectionContext";
import { Config, PanelState } from "./types";

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const selectFocusedTask = (store: TaskStore) => store.focusedTask;

function initPanel(
  collectionParams: DataCollectionContextType,
  crash: ReturnType<typeof useCrash>,
  context: PanelExtensionContext,
) {
  // eslint-disable-next-line react/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <DataCollectionProvider {...collectionParams}>
          <DataCollection context={context} />
        </DataCollectionProvider>
      </CaptureErrorBoundary>
    </StrictMode>,
    context.panelElement,
  );
  return () => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

function DataCollectionPanelAdapter(props: Props) {
  const crash = useCrash();
  const userInfo = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectLoginStatus);

  const consoleApi = useConsoleApi();
  const urlState = useMessagePipeline(selectUrlState);
  const dataSource = useCoreData(selectDataSource);
  const focusedTask = useTasks(selectFocusedTask);

  const deviceLink = urlState?.parameters?.deviceLink ?? "";

  const panelState: PanelState = useMemo(() => {
    if (dataSource?.id !== "coscene-websocket") {
      return "SOURCE_TYPE_NOT_SUPPORTED";
    }

    if (loginStatus === "notLogin") {
      return "NOT_LOGIN";
    }

    if (userInfo == undefined) {
      return "LOADING";
    }

    return "NOMAL";
  }, [dataSource?.id, loginStatus, userInfo]);

  const boundInitPanel = useMemo(() => {
    if (userInfo == undefined) {
      return () => {};
    }

    const collectionParams: DataCollectionContextType = {
      panelState,
      deviceLink,
      userInfo,
      consoleApi,
    };

    return initPanel.bind(undefined, collectionParams, crash);
  }, [userInfo, crash, panelState, deviceLink, consoleApi]);

  // 使用 useMemo 稳定 extensionData 对象引用
  const extensionData = useMemo(
    () => ({
      focusedTask,
    }),
    [focusedTask],
  );

  return (
    <PanelExtensionAdapter
      config={props.config}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
      extensionData={extensionData}
    />
  );
}

DataCollectionPanelAdapter.panelType = "DataCollectionPanel";
DataCollectionPanelAdapter.defaultConfig = {};

export default Panel(DataCollectionPanelAdapter);
