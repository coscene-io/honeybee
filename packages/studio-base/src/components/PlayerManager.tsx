// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import { useSnackbar } from "notistack";
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useContext,
  useLayoutEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { useLatest, useMountedState } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { useWarnImmediateReRender } from "@foxglove/hooks";
import Logger from "@foxglove/log";
import { Immutable } from "@foxglove/studio";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useSetShowtUrlKey } from "@foxglove/studio-base/components/CoreDataSyncAdapter";
import { MessagePipelineProvider } from "@foxglove/studio-base/components/MessagePipeline";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { ExtensionCatalogContext } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { usePerformance } from "@foxglove/studio-base/context/PerformanceContext";
import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useEntitlementWithDialog } from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
import { UploadFilesStore, useUploadFiles } from "@foxglove/studio-base/context/UploadFilesContext";
import {
  UserScriptStore,
  useUserScriptState,
} from "@foxglove/studio-base/context/UserScriptStateContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import useIndexedDbRecents, { RecentRecord } from "@foxglove/studio-base/hooks/useIndexedDbRecents";
import AnalyticsMetricsCollector from "@foxglove/studio-base/players/AnalyticsMetricsCollector";
import {
  TopicAliasFunctions,
  TopicAliasingPlayer,
} from "@foxglove/studio-base/players/TopicAliasingPlayer/TopicAliasingPlayer";
import UserScriptPlayer from "@foxglove/studio-base/players/UserScriptPlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { UserScripts } from "@foxglove/studio-base/types/panels";

const log = Logger.getLogger(__filename);

type PlayerManagerProps = {
  playerSources: readonly IDataSourceFactory[];
};

const EMPTY_USER_NODES: UserScripts = Object.freeze({});
const EMPTY_GLOBAL_VARIABLES: GlobalVariables = Object.freeze({});

const userScriptsSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.userNodes ?? EMPTY_USER_NODES;
const globalVariablesSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.globalVariables ?? EMPTY_GLOBAL_VARIABLES;

const selectUserScriptActions = (store: UserScriptStore) => store.actions;

const selectSetCurrentFile = (store: UploadFilesStore) => store.setCurrentFile;
const selectSetDataSource = (store: CoreDataStore) => store.setDataSource;

const selectRecord = (store: CoreDataStore) => store.record;
const selectProject = (store: CoreDataStore) => store.project;
const selectJobRun = (store: CoreDataStore) => store.jobRun;
const selectDataSource = (store: CoreDataStore) => store.dataSource;

function useBeforeConnectionSource(): (
  sourceId: string,
  params: Record<string, string | undefined>,
) => Promise<boolean> {
  const consoleApi = useConsoleApi();
  const setShowtUrlKey = useSetShowtUrlKey();

  const [entitlement, entitlementDialog] = useEntitlementWithDialog(
    PlanFeatureEnum_PlanFeature.OUTBOUND_TRAFFIC,
  );

  const syncBaseInfo = useCallback(
    async (baseInfoKey: string) => {
      consoleApi.setType("playback");
      try {
        await setShowtUrlKey(baseInfoKey);
      } catch (error) {
        log.error("setShowtUrlKey failed", error);
      }
    },
    [consoleApi, setShowtUrlKey],
  );

  const beforeConnectionSource: (
    sourceId: string,
    params: Record<string, string | undefined>,
  ) => Promise<boolean> = useCallback(
    async (sourceId: string, params: Record<string, string | undefined>) => {
      switch (sourceId) {
        case "coscene-data-platform":
          consoleApi.setType("playback");
          if (entitlement != undefined && entitlement.usage > entitlement.maxQuota) {
            entitlementDialog();
            return false;
          }
          if (!params.key) {
            throw new Error("coscene-data-platform params.key is required");
          }
          // sync base info from bff to state manager
          await syncBaseInfo(params.key);
          // notify honeybeeServer to sync media
          await consoleApi.syncMedia({ key: params.key });
          break;
        case "coscene-websocket":
          if (params.key) {
            await syncBaseInfo(params.key);
          }
          consoleApi.setType("realtime");
          break;
        default:
          consoleApi.setType(undefined);
          break;
      }

      return true;
    },
    [consoleApi, entitlement, syncBaseInfo, entitlementDialog],
  );

  return beforeConnectionSource;
}

export default function PlayerManager(
  props: PropsWithChildren<PlayerManagerProps>,
): React.JSX.Element {
  const { children, playerSources } = props;
  const perfRegistry = usePerformance();
  const [currentSourceArgs, setCurrentSourceArgs] = useState<DataSourceArgs | undefined>();
  const [currentSourceId, setCurrentSourceId] = useState<string | undefined>();
  const analytics = useAnalytics();

  const beforeConnectionSource = useBeforeConnectionSource();
  const setCurrentFile = useUploadFiles(selectSetCurrentFile);

  const confirm = useConfirm();

  const { t } = useTranslation("general");

  useWarnImmediateReRender();

  const userScriptActions = useUserScriptState(selectUserScriptActions);

  const isMounted = useMountedState();

  const consoleApi = useConsoleApi();

  const metricsCollector = useMemo(
    () =>
      new AnalyticsMetricsCollector({
        analytics,
      }),
    [analytics],
  );

  const [playerInstances, setPlayerInstances] = useState<
    { topicAliasPlayer: TopicAliasingPlayer; player: UserScriptPlayer } | undefined
  >();

  const { recents, addRecent } = useIndexedDbRecents();

  const userScripts = useCurrentLayoutSelector(userScriptsSelector);
  const globalVariables = useCurrentLayoutSelector(globalVariablesSelector);
  const globalVariablesRef = useLatest(globalVariables);

  const constructPlayers = useCallback(
    (newPlayer: Player | undefined) => {
      if (!newPlayer) {
        setPlayerInstances(undefined);
        return undefined;
      }

      const topicAliasingPlayer = new TopicAliasingPlayer(newPlayer);
      const userScriptPlayer = new UserScriptPlayer(
        topicAliasingPlayer,
        userScriptActions,
        perfRegistry,
      );

      userScriptPlayer.setGlobalVariables(globalVariablesRef.current);

      setPlayerInstances({
        topicAliasPlayer: topicAliasingPlayer,
        player: userScriptPlayer,
      });
    },
    [globalVariablesRef, perfRegistry, userScriptActions],
  );

  useLayoutEffect(
    () => void playerInstances?.player.setUserScripts(userScripts),
    [playerInstances?.player, userScripts],
  );

  // Update the alias functions when they change. We do not need to re-render the player manager
  // since nothing in the local state has changed.
  const extensionCatalogContext = useContext(ExtensionCatalogContext);
  useEffect(() => {
    // Stable empty alias functions if we don't have any
    const emptyAliasFunctions: Immutable<TopicAliasFunctions> = [];

    // We only want to set alias functions on the player when the functions have changed
    let topicAliasFunctions =
      extensionCatalogContext?.getState().installedTopicAliasFunctions ?? emptyAliasFunctions;
    playerInstances?.topicAliasPlayer.setAliasFunctions(topicAliasFunctions);

    return extensionCatalogContext?.subscribe((state) => {
      if (topicAliasFunctions !== state.installedTopicAliasFunctions) {
        topicAliasFunctions = state.installedTopicAliasFunctions ?? emptyAliasFunctions;
        playerInstances?.topicAliasPlayer.setAliasFunctions(topicAliasFunctions);
      }
    });
  }, [extensionCatalogContext, playerInstances?.topicAliasPlayer]);

  const recordState = useCoreData(selectRecord);
  const projectState = useCoreData(selectProject);
  const jobRunState = useCoreData(selectJobRun);
  const dataSourceState = useCoreData(selectDataSource);

  const recordDisplayName = useMemo(() => {
    return recordState.value?.title ?? "";
  }, [recordState]);
  const projectDisplayName = useMemo(() => {
    return projectState.value?.displayName ?? "";
  }, [projectState]);
  const jobRunsName = useMemo(() => {
    return jobRunState.value?.spec?.spec?.name ?? "";
  }, [jobRunState]);

  // handle page title
  useEffect(() => {
    if (currentSourceArgs?.type === "connection" && currentSourceId) {
      let title = "coScene";
      if (currentSourceId === "coscene-websocket") {
        const deviceName = currentSourceArgs.params?.hostName;
        title = `${t("realtimeViz")} - ${deviceName}`;
      } else if (currentSourceId === "coscene-data-platform") {
        if (jobRunsName) {
          title = `${t("shadowMode")} - #${jobRunsName} - ${t("testing")}`;
        } else {
          title = `${t("viz")} - ${recordDisplayName} - ${projectDisplayName}`;
        }
      }
      if (document.title !== title) {
        document.title = title;
      }
    }
  }, [currentSourceArgs, currentSourceId, t, jobRunsName, recordDisplayName, projectDisplayName]);

  const { enqueueSnackbar } = useSnackbar();

  const [selectedSource, setSelectedSource] = useState<IDataSourceFactory | undefined>();

  const setDataSource = useCoreData(selectSetDataSource);

  const [retentionWindowMs] = useAppConfigurationValue<number>(AppSetting.RETENTION_WINDOW_MS);

  const [currentSourceParams, setCurrentSourceParams] = useState<
    { sourceId: string; args?: DataSourceArgs } | undefined
  >();

  const selectSource = useCallback(
    async (sourceId: string | undefined, args?: DataSourceArgs) => {
      log.debug(`Select Source: ${sourceId}`);

      // If sourceId is undefined, clear the current source selection
      if (sourceId == undefined) {
        setCurrentSourceId(undefined);
        setSelectedSource(undefined);
        setCurrentSourceArgs(undefined);
        setCurrentSourceParams(undefined);
        constructPlayers(undefined);
        setDataSource(undefined);
        return;
      }

      setCurrentSourceId(sourceId);

      const foundSource = playerSources.find(
        (source) => source.id === sourceId || source.legacyIds?.includes(sourceId),
      );

      if (!foundSource) {
        enqueueSnackbar(`Unknown data source: ${sourceId}`, { variant: "warning" });
        return;
      }

      metricsCollector.setProperty("player", sourceId, args);
      setSelectedSource(foundSource);

      // Sample sources don't need args or prompts to initialize
      if (foundSource.type === "sample") {
        setDataSource({ id: sourceId, type: "sample" });
        setCurrentSourceParams({ sourceId, args });

        const newPlayer = foundSource.initialize({
          metricsCollector,
        });

        constructPlayers(newPlayer);
        return;
      }

      if (!args) {
        enqueueSnackbar("Unable to initialize player: no args", { variant: "error" });
        setSelectedSource(undefined);
        return;
      }

      if (playerInstances) {
        await playerInstances.player.close();
      }

      setCurrentSourceArgs(args);
      try {
        switch (args.type) {
          case "connection": {
            const params: Record<string, string | undefined> = {
              ...args.params,
            };

            const sessionId = uuidv4();

            setCurrentSourceParams({ sourceId, args: { type: "connection", params } });

            const isReady = await beforeConnectionSource(sourceId, args.params ?? {});
            if (!isReady) {
              return;
            }

            const newPlayer = foundSource.initialize({
              metricsCollector,
              confirm,
              params: {
                ...args.params,
              },
              consoleApi,
              sessionId,
              retentionWindowMs,
            });

            constructPlayers(newPlayer);

            let recentId = undefined;
            if (args.params?.url || args.params?.key) {
              recentId = addRecent({
                type: "connection",
                sourceId: foundSource.id,
                title: args.params.url ?? t("onlineData"),
                label: foundSource.displayName,
                extra: args.params,
              });
            }

            setDataSource({
              id: sourceId,
              type: "connection",
              sessionId,
              recentId,
            });

            return;
          }

          case "persistent-cache": {
            if (!dataSourceState?.sessionId) {
              enqueueSnackbar("sessionId is required for persistent cache source", {
                variant: "error",
              });
              return;
            }

            setDataSource({
              id: sourceId,
              type: "persistent-cache",
              sessionId: dataSourceState.sessionId,
              previousRecentId: dataSourceState.recentId,
            });
            const newPlayer = foundSource.initialize({
              metricsCollector,
              confirm,
              params: {
                ...args.params,
              },
              consoleApi,
              sessionId: dataSourceState.sessionId,
              retentionWindowMs,
            });

            constructPlayers(newPlayer);
            return;
          }

          case "file": {
            setCurrentSourceParams({ sourceId, args });

            const handle = args.handle;
            const files = args.files;

            // files we can try loading immediately
            // We do not add these to recents entries because putting File in indexedb results in
            // the entire file being stored in the database.
            if (files) {
              let file = files[0];
              const fileList: File[] = [];

              for (const curFile of files) {
                file ??= curFile;
                fileList.push(curFile);
              }
              const multiFile = foundSource.supportsMultiFile === true && fileList.length > 1;

              setCurrentFile(file);

              const newPlayer = foundSource.initialize({
                file: multiFile ? undefined : file,
                files: multiFile ? fileList : undefined,
                metricsCollector,
              });

              constructPlayers(newPlayer);

              setDataSource({ id: sourceId, type: "file" });
              return;
            } else if (handle) {
              const permission = await handle.queryPermission({ mode: "read" });
              if (!isMounted()) {
                return;
              }

              if (permission !== "granted") {
                const newPerm = await handle.requestPermission({ mode: "read" });
                if (newPerm !== "granted") {
                  throw new Error(`Permission denied: ${handle.name}`);
                }
              }

              const file = await handle.getFile();
              if (!isMounted()) {
                return;
              }

              setCurrentFile(file);

              const newPlayer = foundSource.initialize({
                file,
                metricsCollector,
              });

              constructPlayers(newPlayer);
              const recentId = addRecent({
                type: "file",
                title: handle.name,
                sourceId: foundSource.id,
                handle,
              });

              setDataSource({ id: sourceId, type: "file", recentId });
              return;
            }
          }
        }

        enqueueSnackbar("Unable to initialize player", { variant: "error" });
      } catch (error) {
        enqueueSnackbar((error as Error).message, { variant: "error" });
      }
    },
    [
      playerSources,
      metricsCollector,
      playerInstances,
      constructPlayers,
      setDataSource,
      enqueueSnackbar,
      beforeConnectionSource,
      confirm,
      consoleApi,
      retentionWindowMs,
      addRecent,
      t,
      dataSourceState?.sessionId,
      dataSourceState?.recentId,
      setCurrentFile,
      isMounted,
    ],
  );

  // Select a recent entry by id
  // necessary to pull out callback creation to avoid capturing the initial player in closure context
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectRecent = useCallback(
    createSelectRecentCallback(recents, selectSource, enqueueSnackbar),
    [recents, enqueueSnackbar, selectSource],
  );

  // Make a RecentSources array for the PlayerSelectionContext
  const recentSources = useMemo(() => {
    return recents.map((item) => {
      return { id: item.id, title: item.title, label: item.label };
    });
  }, [recents]);

  /**
   *  in data platform, some value change need to reload current source
   *  like  tfCompatibilityMode
   *  or add remove file
   *  And due to the storage mechanism of appconfig, it will not be updated immediately after modification.
   *  You need to manually call reloadCurrentSource and pass in the corresponding value.
   */
  const reloadCurrentSource = useCallback(
    async (params?: Record<string, string | undefined>) => {
      if (currentSourceParams?.args?.type) {
        const args: DataSourceArgs = {
          ...currentSourceParams.args,
          type: currentSourceParams.args.type,
          params:
            currentSourceParams.args.type === "connection"
              ? {
                  ...currentSourceParams.args.params,
                  ...params,
                }
              : params,
        };
        await selectSource(currentSourceParams.sourceId, args);
      } else {
        console.error("currentSourceParams is undefined");
      }
    },
    [currentSourceParams, selectSource],
  );

  const value: PlayerSelection = {
    selectSource,
    selectRecent,
    selectedSource,
    availableSources: playerSources,
    recentSources,
    reloadCurrentSource,
  };

  return (
    <>
      <PlayerSelectionContext.Provider value={value}>
        <MessagePipelineProvider player={playerInstances?.player}>
          {children}
        </MessagePipelineProvider>
      </PlayerSelectionContext.Provider>
    </>
  );
}

/**
 * This was moved out of the PlayerManager function due to a memory leak occurring in memoized state of Start.tsx
 * that was retaining old player instances. Having this callback be defined within the PlayerManager makes it store the
 * player at instantiation within the closure context. That callback is then stored in the memoized state with its closure context.
 * The callback is updated when the player changes but part of the `Start.tsx` holds onto the formerly memoized state for an
 * unknown reason.
 * To make this function safe from storing old closure contexts in old memoized state in components where it
 * is used, it has been moved out of the PlayerManager function.
 */
function createSelectRecentCallback(
  recents: RecentRecord[],
  selectSource: (sourceId: string | undefined, dataSourceArgs?: DataSourceArgs) => Promise<void>,
  enqueueSnackbar: ReturnType<typeof useSnackbar>["enqueueSnackbar"],
) {
  return (recentId: string) => {
    // find the recent from the list and initialize
    const foundRecent = recents.find((value) => value.id === recentId);
    if (!foundRecent) {
      enqueueSnackbar(`Failed to restore recent: ${recentId}`, { variant: "error" });
      return;
    }

    switch (foundRecent.type) {
      case "connection": {
        void selectSource(foundRecent.sourceId, {
          type: "connection",
          params: foundRecent.extra,
        });
        break;
      }
      case "file": {
        void selectSource(foundRecent.sourceId, {
          type: "file",
          handle: foundRecent.handle,
        });
      }
    }
  };
}
