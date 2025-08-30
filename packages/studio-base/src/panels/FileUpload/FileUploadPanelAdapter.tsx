// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo, useCallback, useEffect } from "react";
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
import { PanelConfig, SaveConfig } from "@foxglove/studio-base/types/panels";

import { FileUploadPanel } from "./components/FileUploadPanel";
import { Config, defaultConfig, useFileUploadPanelSettings } from "./config/settings";

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectOrganization = (state: CoreDataStore) => state.organization;
const selectProject = (state: CoreDataStore) => state.project;
const selectDevice = (state: CoreDataStore) => state.device;
const selectDataSource = (state: CoreDataStore) => state.dataSource;

// initPanel will be created inside PanelExtensionAdapter

type Props = {
  config: PanelConfig;
  saveConfig: SaveConfig<PanelConfig>;
};

function FileUploadPanelAdapter({ config, saveConfig }: Props) {
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

  // Convert PanelConfig -> Config
  const fileUploadConfig: Config = {
    ...defaultConfig,
    ...config,
  };

  // Register settings tree
  useFileUploadPanelSettings(fileUploadConfig, saveConfig as SaveConfig<Config>);
  
  // From config extract service settings; memoized for stable identity
  const serviceSettings = useMemo(
    () => ({
      getBagListService: "mock", // fixed mock service
      submitFilesService: "mock", // fixed mock service
    }),
    [],
  );
  
  // Refresh button service config
  const refreshButtonServiceName =
    fileUploadConfig.refreshButtonService.serviceName || "/api/test/end_and_get_candidates";

  // Keep initPanel stable: do not capture changing config in its closure.
  // Use extensionData + onRender to pass latest props to the inner React tree.
  const boundInitPanel = useMemo(() => {
    return (context: PanelExtensionContext) => {
      // Watch for extensionData updates so onRender will be called when it changes.
      context.watch("extensionData");

      context.onRender = (renderState, done) => {
        const ext = (renderState?.extensionData ?? {}) as any;
        const cfg: Config = { ...defaultConfig, ...(ext.fileUploadConfig ?? {}) };
        const svc = ext.serviceSettings ?? serviceSettings;
        const rbsn: string = ext.refreshButtonServiceName ?? refreshButtonServiceName;

        // eslint-disable-next-line react/no-deprecated
        ReactDOM.render(
          <StrictMode>
            <CaptureErrorBoundary onError={crash}>
              <FileUploadPanel
                config={cfg}
                context={context}
                serviceSettings={svc}
                refreshButtonServiceName={rbsn}
              />
            </CaptureErrorBoundary>
          </StrictMode>,
          context.panelElement,
        );
        // Signal render completion to resume the frame.
        done?.();
      };

      return () => {
        ReactDOM.unmountComponentAtNode(context.panelElement);
      };
    };
  // Only depend on crash to preserve error boundary behavior; avoid config-caused reinit.
  }, [crash]);

  // Build extensionData with all dynamic inputs that should cause re-render via onRender.
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
      // Panel props for inner tree, routed via onRender to avoid initPanel recreation
      fileUploadConfig,
      serviceSettings,
      refreshButtonServiceName,
    }),
    [
      userInfo,
      loginStatus,
      consoleApi,
      deviceLink,
      dataSource,
      project.value,
      organization.value,
      device.value,
      fileUploadConfig,
      serviceSettings,
      refreshButtonServiceName,
    ],
  );

  return (
    <PanelExtensionAdapter
      config={fileUploadConfig}
      saveConfig={saveConfig as SaveConfig<Config>}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
      extensionData={extensionData}
    />
  );
}

FileUploadPanelAdapter.panelType = "FileUpload";
FileUploadPanelAdapter.defaultConfig = defaultConfig;

export default Panel(FileUploadPanelAdapter);