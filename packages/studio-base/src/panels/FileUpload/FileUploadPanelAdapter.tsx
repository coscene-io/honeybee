// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

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

  // 检查设备验证状态（仅对IP+端口连接的coscene-websocket数据源）
  const [deviceValidationStatus, setDeviceValidationStatus] = useState(() => {
    if (dataSource?.type === "connection" && (dataSource as any).id === "coscene-websocket") {
      // 检查是否有key参数，如果有说明是平台跳转连接，不需要SN验证
      const urlState = (dataSource as any).urlState;
      if (urlState?.parameters?.key) {
        return { isValid: true }; // 平台跳转连接默认有效
      }

      // 没有key参数说明是IP+端口连接，需要检查SN验证状态
      const player = (dataSource as any).player;
      if (player && typeof player.getDeviceValidationStatus === "function") {
        return player.getDeviceValidationStatus();
      }
    }
    return { isValid: true }; // 非websocket连接默认有效
  });

  // 获取设备序列号（仅对IP+端口连接的coscene-websocket数据源）
  const [deviceSerialNumber, setDeviceSerialNumber] = useState(() => {
    if (dataSource?.type === "connection" && (dataSource as any).id === "coscene-websocket") {
      // 检查是否有key参数，如果有说明是平台跳转连接，不需要SN
      const urlState = (dataSource as any).urlState;
      if (urlState?.parameters?.key) {
        return undefined; // 平台跳转连接不需要SN
      }

      // 没有key参数说明是IP+端口连接，需要获取SN
      const player = (dataSource as any).player;
      if (player && typeof player.getDeviceSerialNumber === "function") {
        return player.getDeviceSerialNumber();
      }
    }
    return undefined;
  });

  // 定期检查设备验证状态的变化（仅对IP+端口连接）
  useEffect(() => {
    if (dataSource?.type === "connection" && (dataSource as any).id === "coscene-websocket") {
      // 检查是否有key参数，如果有说明是平台跳转连接，不需要SN验证
      const urlState = (dataSource as any).urlState;
      if (urlState?.parameters?.key) {
        console.log(`[FileUploadPanelAdapter] 检测到平台跳转连接，跳过SN验证`);
        return; // 平台跳转连接不需要SN验证
      }

      console.log(`[FileUploadPanelAdapter] 检测到IP+端口连接，开始SN验证`);

      // 从 localStorage 读取设备验证信息
      const checkValidationFromCache = () => {
        try {
          const cachedData = localStorage.getItem("coscene-device-validation");
          if (cachedData) {
            const validationData = JSON.parse(cachedData);

            // 检查缓存是否过期（5分钟内有效）
            const now = Date.now();
            const cacheAge = now - validationData.timestamp;
            if (cacheAge > 5 * 60 * 1000) {
              console.log(`[FileUploadPanelAdapter] 缓存已过期，清除缓存`);
              localStorage.removeItem("coscene-device-validation");
              return;
            }

            const newStatus = {
              isValid: validationData.isValid,
              deviceName: validationData.deviceName,
              error: validationData.error,
            };

            setDeviceValidationStatus((prevStatus: any) => {
              if (JSON.stringify(prevStatus) !== JSON.stringify(newStatus)) {
                console.log(`[FileUploadPanelAdapter] 设备验证状态已更新:`, newStatus);
                return newStatus;
              }
              return prevStatus;
            });

            const newSerialNumber = validationData.serialNumber;
            setDeviceSerialNumber((prevSerialNumber: any) => {
              if (prevSerialNumber !== newSerialNumber) {
                console.log(`[FileUploadPanelAdapter] 设备序列号已更新:`, newSerialNumber);
                return newSerialNumber;
              }
              return prevSerialNumber;
            });
          } else {
            // 只在第一次没有缓存时打印日志
            setDeviceValidationStatus((prevStatus: any) => {
              if (prevStatus.isValid !== false || prevStatus.error !== "未找到设备验证信息") {
                console.log(`[FileUploadPanelAdapter] 缓存中无设备验证信息`);
                const defaultStatus = {
                  isValid: false,
                  deviceName: undefined,
                  error: "未找到设备验证信息",
                };
                return defaultStatus;
              }
              return prevStatus;
            });
          }
        } catch (error) {
          console.error(`[FileUploadPanelAdapter] 读取缓存失败:`, error);
        }
      };

      // 立即检查一次
      checkValidationFromCache();

      // 每500ms检查一次缓存变化
      const interval = setInterval(checkValidationFromCache, 500);
      return () => {
        clearInterval(interval);
      };
    }
    return undefined;
  }, [dataSource]);

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
      getBagListService: "coscene-real", // use real CoSceneConsoleApi service
      submitFilesService: "coscene-real", // use real CoSceneConsoleApi service
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

      // Create root only once per panel instance
      let root: ReturnType<typeof createRoot> | undefined;
      let isUnmounted = false;

      context.onRender = (renderState, done) => {
        // Create root on first render if not exists
        if (!root && !isUnmounted) {
          root = createRoot(context.panelElement);
        }

        // Skip rendering if root is unmounted
        if (isUnmounted || !root) {
          done();
          return;
        }

        const ext = (renderState.extensionData ?? {}) as any;
        const cfg: Config = { ...defaultConfig, ...(ext.fileUploadConfig ?? {}) };
        const svc = ext.serviceSettings ?? serviceSettings;
        const rbsn: string = ext.refreshButtonServiceName ?? refreshButtonServiceName;

        root.render(
          <StrictMode>
            <CaptureErrorBoundary onError={crash}>
              <FileUploadPanel
                config={cfg}
                context={context}
                serviceSettings={svc}
                refreshButtonServiceName={rbsn}
                consoleApi={ext.consoleApi}
                device={ext.device}
                organization={ext.organization}
                project={ext.project}
                deviceValidationStatus={ext.deviceValidationStatus}
                deviceSerialNumber={ext.deviceSerialNumber}
              />
            </CaptureErrorBoundary>
          </StrictMode>,
        );
        // Signal render completion to resume the frame.
        done();
      };

      return () => {
        isUnmounted = true;
        if (root) {
          root.unmount();
          root = undefined;
        }
      };
    };
  }, [crash, serviceSettings, refreshButtonServiceName]);

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
      deviceValidationStatus,
      deviceSerialNumber,
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
      deviceValidationStatus,
      deviceSerialNumber,
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
