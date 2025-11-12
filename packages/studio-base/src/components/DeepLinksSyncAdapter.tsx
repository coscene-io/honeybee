// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import Logger from "@foxglove/log";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useSetExternalInitConfig } from "@foxglove/studio-base/components/CoreDataSyncAdapter";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  CoreDataStore,
  ExternalInitConfig,
  useCoreData,
} from "@foxglove/studio-base/context/CoreDataContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import {
  DataSourceArgs,
  usePlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { useSyncLayoutFromUrl } from "@foxglove/studio-base/hooks/useSyncLayoutFromUrl";
import { useSyncTimeFromUrl } from "@foxglove/studio-base/hooks/useSyncTimeFromUrl";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

const log = Logger.getLogger(__filename);

const selectUser = (store: UserStore) => store.user;
const selectUserLoginStatus = (store: UserStore) => store.loginStatus;
const selectWorkspaceDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;
const selectSetIsReadyForSyncLayout = (state: CoreDataStore) => state.setIsReadyForSyncLayout;

const DEFAULT_DEEPLINKS = Object.freeze([]);

/**
 * DeepLinksSyncAdapter
 *
 * 负责处理应用启动时的深度链接（deep links）初始化：
 * 1. 解析 URL 参数，初始化数据源和项目上下文
 * 2. 在用户刷新页面时，从缓存恢复上次的项目配置
 * 3. 协调 layout 和播放时间的同步
 */
export function DeepLinksSyncAdapter({
  deepLinks = DEFAULT_DEEPLINKS,
}: {
  deepLinks?: readonly string[];
}): ReactNull {
  // ========== 依赖和状态 ==========
  const { t } = useTranslation("workspace");
  const domainConfig = getDomainConfig();

  // 数据源和用户相关
  const { selectSource } = usePlayerSelection();
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);

  // 工作区状态
  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const { dialogActions } = useWorkspaceActions();
  const selectEvent = useEvents(selectSelectEvent);

  // ========== URL 解析和验证 ==========
  const targetUrlState = useMemo(() => {
    if (deepLinks[0] == undefined) {
      return undefined;
    }

    const url = new URL(deepLinks[0]);
    const parsedUrl = parseAppURLState(url);

    // 桌面应用的域名验证
    if (
      isDesktopApp() &&
      parsedUrl?.ds === "coscene-data-platform" &&
      url.hostname !== domainConfig.webDomain
    ) {
      dialogActions.dataSource.close();
      setTimeout(() => {
        toast.error(t("invalidDomain", { domain: domainConfig.webDomain }));
      }, 1000);
      return undefined;
    }

    return parsedUrl;
  }, [deepLinks, t, domainConfig.webDomain, dialogActions.dataSource]);

  // ========== 状态管理 ==========
  // 待应用的数据源参数（只在组件挂载时从 URL 初始化一次）
  const [unappliedSourceArgs, setUnappliedSourceArgs] = useState(() =>
    targetUrlState
      ? {
          ds: targetUrlState.ds,
          dsParams: targetUrlState.dsParams,
          layoutId: targetUrlState.layoutId,
        }
      : undefined,
  );

  // 处理状态标记
  const isSourceProcessed = useRef(false);
  const currentSource = useRef<(DataSourceArgs & { id: string }) | undefined>(undefined);

  // ========== 工具函数 ==========
  // 防抖的登录提示
  const debouncedPleaseLoginFirstToast = useMemo(() => {
    return _.debounce(() => {
      toast.error(t("pleaseLoginFirst", { ns: "openDialog" }));
      setTimeout(() => {
        if (isDesktopApp()) {
          window.open(`https://${domainConfig.webDomain}/studio/login`);
        } else {
          window.location.href = `/login?redirectToPath=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
        }
      }, 500);
    }, 1000);
  }, [t, domainConfig.webDomain]);

  // ========== 配置和 API ==========
  const [lastExternalInitConfig, setLastExternalInitConfig] = useAppConfigurationValue<string>(
    AppSetting.LAST_EXTERNAL_INIT_CONFIG,
  );

  const consoleApi = useConsoleApi();
  const setExternalInitConfig = useSetExternalInitConfig();
  const setIsReadyForSyncLayout = useCoreData(selectSetIsReadyForSyncLayout);

  /**
   * 从 lastExternalInitConfig 恢复项目配置
   *
   * 用于用户刷新页面时，在没有 URL 参数的情况下恢复上次的项目上下文
   *
   * 流程：
   * 1. 检查是否有缓存配置
   * 2. 验证配置完整性
   * 3. 验证项目是否仍然存在
   * 4. 设置 externalInitConfig 或 isReadyForSyncLayout
   */
  const loadLastExternalInitConfig = useCallback(async () => {
    if (!lastExternalInitConfig) {
      // 没有缓存配置，直接标记准备好同步 layout
      setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
      return;
    }

    try {
      const parsedConfig = JSON.parse(lastExternalInitConfig) as ExternalInitConfig;

      // 验证配置完整性
      if (!parsedConfig.warehouseId || !parsedConfig.projectId) {
        setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
        return;
      }

      const projectName = `warehouses/${parsedConfig.warehouseId}/projects/${parsedConfig.projectId}`;

      // 验证项目是否仍然存在
      const targetProject = await consoleApi.getProject({ projectName });

      if (targetProject.name) {
        // 项目存在，设置配置（会自动设置 isReadyForSyncLayout）
        await setExternalInitConfig(parsedConfig);
      } else {
        // 项目不存在，清理缓存
        await setLastExternalInitConfig(undefined);
        setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
      }
    } catch (error) {
      log.debug("Failed to restore from lastExternalInitConfig", error);
      await setLastExternalInitConfig(undefined);
      setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
    }
  }, [
    consoleApi,
    lastExternalInitConfig,
    setExternalInitConfig,
    setLastExternalInitConfig,
    setIsReadyForSyncLayout,
  ]);

  // ========== 处理数据源初始化的主逻辑 ==========
  /**
   * 数据源初始化主逻辑
   *
   * 特殊情况：未登录访问需要登录的数据源
   *   → 显示登录提示
   *   → 引导用户登录
   *
   * 两种初始化路径：
   *
   * 路径 1（有 ds 参数）：从 URL 参数初始化
   *   → 等待登录和用户信息
   *   → 构建 sourceParams
   *   → 调用 selectSource（内部会设置 externalInitConfig 和 isReadyForSyncLayout）
   *   → 选择事件
   *
   * 路径 2（无 ds 参数）：从缓存恢复
   *   → 调用 loadLastExternalInitConfig
   *   → 验证并恢复项目配置
   *   → 设置 isReadyForSyncLayout
   */
  useEffect(() => {
    // 确保只处理一次
    if (isSourceProcessed.current) {
      return;
    }

    // 特殊情况：用户未登录但试图访问需要登录的数据源
    if (loginStatus === "notLogin" && unappliedSourceArgs?.ds) {
      isSourceProcessed.current = true;
      debouncedPleaseLoginFirstToast();
      setUnappliedSourceArgs(undefined);
      return;
    }

    // 用户未登录，不设置data source，直接设置恢复layout的标志
    if (loginStatus !== "alreadyLogin") {
      isSourceProcessed.current = true;
      setUnappliedSourceArgs(undefined);
      setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
      return;
    }

    // 路径 1：从 URL 参数初始化数据源
    if (unappliedSourceArgs?.ds != undefined) {
      // 关闭数据源对话框
      if (dataSourceDialog.open) {
        dialogActions.dataSource.close();
      }

      // 等待用户信息同步完成
      if (currentUser?.userId == undefined) {
        return;
      }

      // 构建数据源参数
      const sourceParams: DataSourceArgs = {
        type: "connection",
        params: {
          ...currentUser,
          ...unappliedSourceArgs.dsParams,
        },
      };

      // 避免重复初始化相同的数据源
      if (_.isEqual({ id: unappliedSourceArgs.ds, ...sourceParams }, currentSource.current)) {
        isSourceProcessed.current = true;
        return;
      }

      log.debug("Initialising source from URL", unappliedSourceArgs);

      // 记录当前数据源
      currentSource.current = { id: unappliedSourceArgs.ds, ...sourceParams };

      // 初始化数据源（selectSource 内部会通过 key 调用 setShowtUrlKey，从而设置 externalInitConfig）
      selectSource(unappliedSourceArgs.ds, sourceParams);

      // 选择事件（如果有）
      selectEvent(unappliedSourceArgs.dsParams?.eventId);

      // 清理待应用的参数
      setUnappliedSourceArgs(undefined);
      isSourceProcessed.current = true;
      return;
    }

    // 路径 2：从缓存恢复项目配置
    void loadLastExternalInitConfig();
    isSourceProcessed.current = true;
  }, [
    currentUser,
    selectEvent,
    selectSource,
    unappliedSourceArgs,
    loginStatus,
    dataSourceDialog.open,
    dialogActions.dataSource,
    debouncedPleaseLoginFirstToast,
    loadLastExternalInitConfig,
    setIsReadyForSyncLayout,
  ]);

  /**
   * 清理逻辑：用户登出时清除缓存的配置
   */
  useAsync(async () => {
    if (loginStatus === "notLogin") {
      void setLastExternalInitConfig(undefined);
    }
  }, [loginStatus, setLastExternalInitConfig]);

  /**
   * 同步 layout 和播放时间
   * 这些 hooks 会等待 isReadyForSyncLayout 标志后再执行
   */
  useSyncLayoutFromUrl(targetUrlState);
  useSyncTimeFromUrl(targetUrlState);

  return ReactNull;
}
