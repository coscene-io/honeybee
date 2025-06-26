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
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  useCurrentUser,
  User,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { DataCollection } from "./DataCollection";
import { Config, PanelState } from "./types";

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectDataSource = (state: CoSceneBaseStore) => state.dataSource;

function initPanel(
  panelState: PanelState,
  deviceLink: string,
  userInfo: User,
  consoleApi: ConsoleApi,
  crash: ReturnType<typeof useCrash>,
  context: PanelExtensionContext,
) {
  // eslint-disable-next-line react/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <DataCollection
          panelState={panelState}
          deviceLink={deviceLink}
          context={context}
          userInfo={userInfo}
          consoleApi={consoleApi}
        />
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
  const dataSource = useBaseInfo(selectDataSource);

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
    return initPanel.bind(undefined, panelState, deviceLink, userInfo, consoleApi, crash);
  }, [crash, consoleApi, userInfo, deviceLink, panelState]);

  return (
    <PanelExtensionAdapter
      config={props.config}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
    />
  );
}

DataCollectionPanelAdapter.panelType = "DataCollectionPanel";
DataCollectionPanelAdapter.defaultConfig = {};

export default Panel(DataCollectionPanelAdapter);
