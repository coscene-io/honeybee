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
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import FaultRecordPanel from "./FaultRecordPanel";
import { defaultConfig, useFaultRecordPanelSettings, type FaultRecordConfig } from "./settings";

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectOrganization = (state: CoreDataStore) => state.organization;
const selectProject = (state: CoreDataStore) => state.project;
const selectDevice = (state: CoreDataStore) => state.device;
const selectDataSource = (state: CoreDataStore) => state.dataSource;

function initPanel(
  crash: ReturnType<typeof useCrash>,
  config: FaultRecordConfig,
  saveConfig: SaveConfig<FaultRecordConfig>,
  context: PanelExtensionContext,
) {
  // eslint-disable-next-line react/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <FaultRecordPanel context={context} />
      </CaptureErrorBoundary>
    </StrictMode>,
    context.panelElement,
  );

  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}

type Props = {
  config: FaultRecordConfig;
  saveConfig: SaveConfig<FaultRecordConfig>;
};

function FaultRecordPanelAdapter({ config, saveConfig }: Props) {
  const crash = useCrash();
  const userInfo = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectLoginStatus);
  
  const consoleApi = useConsoleApi();
  const urlState = useMessagePipeline(selectUrlState);
  const dataSource = useCoreData(selectDataSource);
  
  const project = useCoreData(selectProject);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const organization = useCoreData(selectOrganization);
  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);
  const device = useCoreData(selectDevice);
  const deviceId = useMemo(() => device.value?.name.split("/").pop(), [device]);

  const deviceLink =
    urlState?.parameters?.deviceLink ??
    `/${organizationSlug}/${projectSlug}/devices/project-devices/${deviceId}`;

  // 使用设置钩子来处理面板设置
  const mergedConfig = { ...defaultConfig, ...config };
  useFaultRecordPanelSettings(mergedConfig, saveConfig);

  const boundInitPanel = useMemo(
    () =>
      initPanel.bind(undefined, crash, mergedConfig, saveConfig),
    [crash, mergedConfig, saveConfig],
  );

  // 使用 useMemo 稳定 extensionData 对象引用
  const extensionData = useMemo(
    () => ({
      userInfo,
      loginStatus,
      consoleApi,
      deviceLink,
      dataSource,
      project: project.value,
      organization: organization.value,
      device: device.value,
    }),
    [userInfo, loginStatus, consoleApi, deviceLink, dataSource, project.value, organization.value, device.value],
  );

  return (
    <PanelExtensionAdapter
      config={config}
      saveConfig={saveConfig}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
      extensionData={extensionData}
    />
  );
}

FaultRecordPanelAdapter.panelType = "FaultRecord";

FaultRecordPanelAdapter.defaultConfig = defaultConfig;

export default Panel<FaultRecordConfig, Props>(FaultRecordPanelAdapter);