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

export function DeepLinksSyncAdapter({
  deepLinks = DEFAULT_DEEPLINKS,
}: {
  deepLinks?: readonly string[];
}): ReactNull {
  const { t } = useTranslation("workspace");
  const domainConfig = getDomainConfig();

  const { selectSource } = usePlayerSelection();
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);
  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const { dialogActions } = useWorkspaceActions();
  const selectEvent = useEvents(selectSelectEvent);

  const targetUrlState = useMemo(() => {
    if (deepLinks[0] == undefined) {
      return undefined;
    }

    const url = new URL(deepLinks[0]);
    const parsedUrl = parseAppURLState(url);

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

  // 初始化 unappliedSourceArgs，只在组件挂载时设置一次
  // 使用函数初始化形式，确保只计算一次
  const [unappliedSourceArgs, setUnappliedSourceArgs] = useState(() =>
    targetUrlState
      ? {
          ds: targetUrlState.ds,
          dsParams: targetUrlState.dsParams,
          layoutId: targetUrlState.layoutId,
        }
      : undefined,
  );

  // 标记是否已经处理过数据源
  const isSourceProcessed = useRef(false);

  // Ensure that the data source is initialised only once
  const currentSource = useRef<(DataSourceArgs & { id: string }) | undefined>(undefined);

  const debouncedPleaseLoginFirstToast = useMemo(() => {
    return _.debounce(() => {
      toast.error(t("pleaseLoginFirst", { ns: "openDialog" }));
      setTimeout(() => {
        if (isDesktopApp()) {
          window.open(`https://${domainConfig.webDomain}/studio/login`);
        } else {
          // In web environment, navigate to login page with redirect
          window.location.href = `/login?redirectToPath=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
        }
      }, 500);
    }, 1000);
  }, [t, domainConfig.webDomain]);

  const [lastExternalInitConfig, setLastExternalInitConfig] = useAppConfigurationValue<string>(
    AppSetting.LAST_EXTERNAL_INIT_CONFIG,
  );

  const consoleApi = useConsoleApi();
  const setExternalInitConfig = useSetExternalInitConfig();
  const setIsReadyForSyncLayout = useCoreData(selectSetIsReadyForSyncLayout);

  const loadLastExternalInitConfig = useCallback(async () => {
    if (lastExternalInitConfig) {
      try {
        const parsedConfig = JSON.parse(lastExternalInitConfig) as ExternalInitConfig;
        const projectName =
          parsedConfig.warehouseId && parsedConfig.projectId
            ? `warehouses/${parsedConfig.warehouseId}/projects/${parsedConfig.projectId}`
            : undefined;

        if (projectName) {
          // login 才能调用 consoleApi
          await consoleApi
            .getProject({ projectName })
            .then((targetProject) => {
              if (targetProject.name) {
                void setExternalInitConfig(parsedConfig);
              }
            })
            .catch((error: unknown) => {
              log.debug("Failed to restore from lastExternalInitConfig", error);
              void setLastExternalInitConfig(undefined);
            });
          return;
        }
      } catch (error) {
        log.debug("parse lastExternalInitConfig failed", error);
      }
    }
    setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
  }, [
    setExternalInitConfig,
    lastExternalInitConfig,
    consoleApi,
    setLastExternalInitConfig,
    setIsReadyForSyncLayout,
  ]);

  // 处理数据源加载：如果有 ds 则通过 selectSource，否则通过 lastExternalInitConfig
  useEffect(() => {
    // 如果已经处理过，不再处理
    if (isSourceProcessed.current) {
      return;
    }

    // 如果登录状态不是已登录，等待登录
    if (loginStatus !== "alreadyLogin") {
      // void setExternalInitConfig({});
      // isSourceProcessed.current = true;
      return;
    }

    // 如果有待应用的数据源参数
    if (unappliedSourceArgs?.ds != undefined) {
      if (dataSourceDialog.open) {
        dialogActions.dataSource.close();
      }

      // sync user info need time, so in some case, loginStatus is alreadyLogin but currentUser is undefined
      if (currentUser?.userId == undefined) {
        return;
      }

      // Apply any available data source args
      log.debug("Initialising source from url", unappliedSourceArgs);
      const sourceParams: DataSourceArgs = {
        type: "connection",
        params: {
          ...currentUser,
          ...unappliedSourceArgs.dsParams,
        },
      };

      if (_.isEqual({ id: unappliedSourceArgs.ds, ...sourceParams }, currentSource.current)) {
        isSourceProcessed.current = true;
        return;
      }

      currentSource.current = { id: unappliedSourceArgs.ds, ...sourceParams };

      // selectSource 内部会通过 key 调用 setShowtUrlKey，从而设置 externalInitConfig
      selectSource(unappliedSourceArgs.ds, sourceParams);
      selectEvent(unappliedSourceArgs.dsParams?.eventId);
      setUnappliedSourceArgs(undefined);
      isSourceProcessed.current = true;
    } else {
      // 没有 ds 参数，尝试从 lastExternalInitConfig 恢复
      void loadLastExternalInitConfig();
      isSourceProcessed.current = true;
    }
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
  ]);

  // 清理未登录时的 lastExternalInitConfig
  useAsync(async () => {
    if (loginStatus === "notLogin") {
      void setLastExternalInitConfig(undefined);
    }
  }, [loginStatus, setLastExternalInitConfig]);

  // 在 isReadyForSyncLayout 为 true 后，同步 layout 和 time
  useSyncLayoutFromUrl(targetUrlState);
  useSyncTimeFromUrl(targetUrlState);

  return ReactNull;
}
