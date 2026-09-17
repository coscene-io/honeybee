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

import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import { useSnackbar } from "notistack";
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import AnalyticsMetricsCollector from "@foxglove/studio-base/players/AnalyticsMetricsCollector";
import {
  TopicAliasFunctions,
  TopicAliasingPlayer,
} from "@foxglove/studio-base/players/TopicAliasingPlayer/TopicAliasingPlayer";
import UserScriptPlayer from "@foxglove/studio-base/players/UserScriptPlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { playbackPerformanceMetrics } from "@foxglove/studio-base/services/playbackPerformanceTelemetry";
import { UserScripts } from "@foxglove/studio-base/types/panels";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

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
const selectSetIsReadyForSyncLayout = (store: CoreDataStore) => store.setIsReadyForSyncLayout;

const selectRecord = (store: CoreDataStore) => store.record;
const selectProject = (store: CoreDataStore) => store.project;
const selectJobRun = (store: CoreDataStore) => store.jobRun;

/** Close the current player, optionally requiring teardown to complete before source replacement. */
export async function closePlayerForSourceSwitch(
  player: Pick<Player, "close"> | undefined,
  { propagateError = false }: { propagateError?: boolean } = {},
): Promise<void> {
  if (player == undefined) {
    return;
  }

  try {
    await player.close();
  } catch (error) {
    log.warn("Failed to close current player while switching sources:", error);
    if (propagateError) {
      throw error;
    }
  }
}

function useBeforeConnectionSource(): (
  sourceId: string,
  params: Record<string, string | undefined>,
  isCurrent?: () => boolean,
) => Promise<boolean> {
  const consoleApi = useConsoleApi();
  const setShowtUrlKey = useSetShowtUrlKey();
  const setIsReadyForSyncLayout = useCoreData(selectSetIsReadyForSyncLayout);

  const syncBaseInfo = useCallback(
    async (baseInfoKey: string, isCurrent: () => boolean) => {
      if (!isCurrent()) {
        return;
      }
      consoleApi.setType("playback");
      await setShowtUrlKey(baseInfoKey, { isCurrent });
    },
    [consoleApi, setShowtUrlKey],
  );

  const beforeConnectionSource: (
    sourceId: string,
    params: Record<string, string | undefined>,
    isCurrent?: () => boolean,
  ) => Promise<boolean> = useCallback(
    async (
      sourceId: string,
      params: Record<string, string | undefined>,
      isCurrent = () => true,
    ) => {
      if (!isCurrent()) {
        return false;
      }
      switch (sourceId) {
        case "coscene-data-platform":
          if (!params.key) {
            throw new Error("coscene-data-platform params.key is required");
          }
          // sync base info from bff to state manager
          await syncBaseInfo(params.key, isCurrent);
          if (!isCurrent()) {
            return false;
          }
          // notify honeybeeServer to sync media
          await consoleApi.syncMedia({ key: params.key });
          if (!isCurrent()) {
            return false;
          }
          break;
        case "coscene-websocket":
          if (params.key) {
            await syncBaseInfo(params.key, isCurrent);
          }
          if (!isCurrent()) {
            return false;
          }
          consoleApi.setType("realtime");
          break;
        case "remote-mp4":
          if (params.key) {
            await syncBaseInfo(params.key, isCurrent);
          } else {
            // Standalone remote-mp4 only needs a URL. Without a key there is no
            // project context to load, but layout sync still waits on this flag.
            setIsReadyForSyncLayout({ isReadyForSyncLayout: true });
          }
          if (!isCurrent()) {
            return false;
          }
          consoleApi.setType(undefined);
          break;
        default:
          consoleApi.setType(undefined);
          break;
      }

      return isCurrent();
    },
    [consoleApi, setIsReadyForSyncLayout, syncBaseInfo],
  );

  return beforeConnectionSource;
}

/** Mark a previous realtime cache session for asynchronous janitor cleanup. */
export async function markRealtimeCacheForCleanup(sessionId?: string): Promise<void> {
  if (sessionId == undefined) {
    return;
  }

  let idbCache: IndexedDbMessageStore | undefined;
  try {
    idbCache = new IndexedDbMessageStore({
      sessionId,
      kind: "realtime-viz",
    });
    // Sealing starts shutdown synchronously, before the store's asynchronous initialization can
    // register this connection as a new writer for the existing session.
    await idbCache.discardAndSeal("pending-delete");
  } catch (error) {
    log.warn("Failed to mark realtime cache for cleanup:", error);
  } finally {
    try {
      await idbCache?.close();
    } catch (error) {
      log.debug("Failed to close idb cache after cleanup:", error);
    }
  }
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
  const [entitlement, entitlementDialog] = useEntitlementWithDialog(
    PlanFeatureEnum_PlanFeature.OUTBOUND_TRAFFIC,
  );

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

  // Track installations synchronously: React can batch away an intermediate player before
  // MessagePipelineProvider mounts it and can register its close-on-replacement cleanup.
  const currentPlayerRef = useRef<{
    player: Player;
    dataSource: NonNullable<CoreDataStore["dataSource"]>;
  }>();
  const setDataSource = useCoreData(selectSetDataSource);

  const { recents, addRecent } = useIndexedDbRecents();

  const userScripts = useCurrentLayoutSelector(userScriptsSelector);
  const globalVariables = useCurrentLayoutSelector(globalVariablesSelector);
  const globalVariablesRef = useLatest(globalVariables);

  const installPlayer = useCallback(
    (newPlayer: Player | undefined, dataSource: CoreDataStore["dataSource"]) => {
      const previousSessionId = currentPlayerRef.current?.dataSource.sessionId;
      if (previousSessionId != undefined && previousSessionId !== dataSource?.sessionId) {
        void markRealtimeCacheForCleanup(previousSessionId);
      }
      if (newPlayer == undefined || dataSource == undefined) {
        currentPlayerRef.current = undefined;
        setPlayerInstances(undefined);
        setDataSource(undefined);
        return;
      }

      const topicAliasingPlayer = new TopicAliasingPlayer(newPlayer);
      const userScriptPlayer = new UserScriptPlayer(
        topicAliasingPlayer,
        userScriptActions,
        perfRegistry,
      );

      userScriptPlayer.setGlobalVariables(globalVariablesRef.current);

      currentPlayerRef.current = { player: userScriptPlayer, dataSource };
      setDataSource(dataSource);
      setPlayerInstances({
        topicAliasPlayer: topicAliasingPlayer,
        player: userScriptPlayer,
      });
    },
    [globalVariablesRef, perfRegistry, userScriptActions, setDataSource],
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

  const [retentionWindowMs] = useAppConfigurationValue<number>(AppSetting.RETENTION_WINDOW_MS);
  const [requestWindow] = useAppConfigurationValue<number>(AppSetting.REQUEST_WINDOW);
  const [readAheadDuration] = useAppConfigurationValue<number>(AppSetting.READ_AHEAD_DURATION);
  const [enablePlaybackSpillCache = false] = useAppConfigurationValue<boolean>(
    AppSetting.PLAYBACK_SPILL_CACHE_ENABLED,
  );
  const [manifestStorageSource] = useAppConfigurationValue<string>(
    AppSetting.MANIFEST_STORAGE_SOURCE,
  );
  const [autoConnectToLan] = useAppConfigurationValue<boolean>(AppSetting.AUTO_CONNECT_LAN);

  const positiveRequestWindow =
    requestWindow != undefined && requestWindow > 0 ? requestWindow : undefined;
  const positiveReadAheadDuration =
    readAheadDuration != undefined && readAheadDuration > 0 ? readAheadDuration : undefined;

  const [currentSourceParams, setCurrentSourceParams] = useState<
    { sourceId: string; args?: DataSourceArgs } | undefined
  >();
  const sourceSelectionGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      // isMounted() rejects pending selections after a real unmount. Do not invalidate
      // their generation here: StrictMode replays effect cleanup during initial mount.
      void closePlayerForSourceSwitch(currentPlayerRef.current?.player);
      currentPlayerRef.current = undefined;
    };
  }, []);

  const selectSource = useCallback(
    async (sourceId: string | undefined, args?: DataSourceArgs) => {
      log.debug(`Select Source: ${sourceId}`);

      const isPersistentCacheSource = args?.type === "persistent-cache";

      // If sourceId is undefined, clear the current source selection
      if (sourceId == undefined) {
        // A real teardown must invalidate in-flight source switches.
        sourceSelectionGenerationRef.current += 1;
        void closePlayerForSourceSwitch(currentPlayerRef.current?.player);
        // Flush any tracked sampled seek before the player goes away: this path bypasses both
        // setProperty("player", ...) and the collector's close(), so without the flush a stale
        // seek could later emit as settled/timeout with counters from a player that no longer
        // exists.
        playbackPerformanceMetrics.handlePlayerChange();
        setCurrentSourceId(undefined);
        setSelectedSource(undefined);
        setCurrentSourceArgs(undefined);
        setCurrentSourceParams(undefined);
        installPlayer(undefined, undefined);
        return;
      }

      const foundSource = playerSources.find(
        (source) => source.id === sourceId || (source.legacyIds?.includes(sourceId) ?? false),
      );

      if (!foundSource) {
        enqueueSnackbar(`Unknown data source: ${sourceId}`, { variant: "warning" });
        return;
      }

      if (foundSource.type !== "sample" && args == undefined) {
        enqueueSnackbar("Unable to initialize player: no args", { variant: "error" });
        return;
      }

      if (foundSource.type !== "sample" && args != undefined && args.type !== foundSource.type) {
        enqueueSnackbar(`Unable to initialize player: ${foundSource.type} arguments are required`, {
          variant: "error",
        });
        return;
      }
      if (
        foundSource.type === "file" &&
        args?.type === "file" &&
        args.handle == undefined &&
        (args.files?.length ?? 0) === 0
      ) {
        enqueueSnackbar("Unable to initialize player: a file or file handle is required", {
          variant: "error",
        });
        return;
      }
      if (
        foundSource.id === "coscene-data-platform" &&
        args?.type === "connection" &&
        !args.params?.key
      ) {
        enqueueSnackbar("coscene-data-platform params.key is required", { variant: "error" });
        return;
      }

      if (foundSource.type === "connection" && args?.type === "connection") {
        const missingParam = foundSource.requiredParams?.find(
          (param) => (args.params?.[param]?.trim().length ?? 0) === 0,
        );
        if (missingParam != undefined) {
          enqueueSnackbar(`Unable to initialize player: ${missingParam} is required`, {
            variant: "error",
          });
          return;
        }
      }

      const previousPlayer = currentPlayerRef.current;
      const requestedReplaySessionId =
        args?.type === "persistent-cache" ? args.params?.sessionId : undefined;
      const replaySessionId =
        requestedReplaySessionId != undefined && requestedReplaySessionId !== ""
          ? requestedReplaySessionId
          : previousPlayer?.dataSource.sessionId;
      const replayRecentId = previousPlayer?.dataSource.recentId;
      if (args?.type === "persistent-cache" && replaySessionId == undefined) {
        enqueueSnackbar("sessionId is required for persistent cache source", {
          variant: "error",
        });
        return;
      }

      const selectionGeneration = ++sourceSelectionGenerationRef.current;
      const isCurrentSelection = () =>
        isMounted() && selectionGeneration === sourceSelectionGenerationRef.current;
      const isOwnRealtimeReplay =
        isPersistentCacheSource &&
        previousPlayer?.dataSource.type === "connection" &&
        previousPlayer.dataSource.sessionId === replaySessionId;

      // Publish the source identity only after the winning request finishes initialization.
      // A superseded request must not change the selection or reload target of the live player.
      const commitSourceState = () => {
        setCurrentSourceId(sourceId);
        metricsCollector.setProperty("player", sourceId, args);
        setSelectedSource(foundSource);
        setCurrentSourceArgs(args);
        if (args?.type !== "persistent-cache") {
          setCurrentSourceParams({
            sourceId,
            args: args?.type === "connection" ? { ...args, params: { ...args.params } } : args,
          });
        }
      };

      const commitFailedSource = () => {
        commitSourceState();
        installPlayer(undefined, undefined);
      };

      try {
        await closePlayerForSourceSwitch(previousPlayer?.player, {
          // Realtime replay must never open a session whose final cache flush failed. Other source
          // switches retain the existing best-effort teardown behavior for compatibility.
          propagateError: isOwnRealtimeReplay,
        });
      } catch (error) {
        if (!isCurrentSelection()) {
          return;
        }
        if (currentPlayerRef.current === previousPlayer) {
          previousPlayer?.player.reOpen();
          setDataSource(previousPlayer?.dataSource);
        }
        enqueueSnackbar(`Unable to switch to playback: ${(error as Error).message}`, {
          variant: "error",
        });
        return;
      }
      if (!isCurrentSelection()) {
        return;
      }
      if (!isPersistentCacheSource) {
        setDataSource(undefined);
      }

      try {
        if (foundSource.type === "sample") {
          const newPlayer = await foundSource.initialize({ metricsCollector });
          if (!isCurrentSelection()) {
            await closePlayerForSourceSwitch(newPlayer);
            return;
          }
          if (newPlayer == undefined) {
            throw new Error("Unable to initialize sample player");
          }
          commitSourceState();
          installPlayer(newPlayer, { id: sourceId, type: "sample" });
          return;
        }

        if (args == undefined) {
          return;
        }
        switch (args.type) {
          case "connection": {
            const sessionId = uuidv4();
            setDataSource({ id: sourceId, type: "connection", sessionId, params: args.params });

            const isReady = await beforeConnectionSource(
              sourceId,
              args.params ?? {},
              isCurrentSelection,
            );
            if (!isCurrentSelection()) {
              return;
            }
            if (!isReady) {
              commitFailedSource();
              return;
            }

            const checkOutboundTrafficEntitlement = () => {
              if (entitlement != undefined && entitlement.usage > entitlement.maxQuota) {
                entitlementDialog();
                return false;
              }
              return true;
            };

            const newPlayer = await foundSource.initialize({
              metricsCollector,
              confirm,
              params: {
                ...args.params,
              },
              consoleApi,
              sessionId,
              retentionWindowMs,
              requestWindow:
                positiveRequestWindow != undefined
                  ? { sec: positiveRequestWindow, nsec: 0 }
                  : undefined,
              readAheadDuration:
                positiveReadAheadDuration != undefined
                  ? { sec: positiveReadAheadDuration, nsec: 0 }
                  : undefined,
              enablePlaybackSpillCache,
              manifestStorageSource,
              autoConnectToLan,
              checkOutboundTrafficEntitlement,
            });
            if (!isCurrentSelection()) {
              await closePlayerForSourceSwitch(newPlayer);
              return;
            }

            if (newPlayer == undefined) {
              throw new Error("Unable to initialize connection player");
            }

            commitSourceState();
            const recentId =
              sourceId === SHARE_MANIFEST_DATA_SOURCE_ID
                ? undefined
                : addRecent({
                    type: "connection",
                    sourceId: foundSource.id,
                    title: args.params?.url ?? t("onlineData"),
                    label: foundSource.displayName,
                    extra: args.params,
                  });

            installPlayer(newPlayer, {
              id: sourceId,
              type: "connection",
              sessionId,
              recentId,
              params: args.params,
            });

            return;
          }

          case "persistent-cache": {
            const newPlayer = await foundSource.initialize({
              metricsCollector,
              confirm,
              params: {
                ...args.params,
              },
              consoleApi,
              sessionId: replaySessionId,
              retentionWindowMs,
            });
            if (!isCurrentSelection()) {
              await closePlayerForSourceSwitch(newPlayer);
              return;
            }
            if (!newPlayer) {
              throw new Error("Unable to initialize persistent cache player");
            }

            commitSourceState();
            installPlayer(newPlayer, {
              id: sourceId,
              type: "persistent-cache",
              sessionId: replaySessionId,
              previousRecentId: replayRecentId,
            });
            return;
          }

          case "file": {
            const handle = args.handle;
            const files = args.files;

            // files we can try loading immediately
            // We do not add these to recents entries because putting File in indexedb results in
            // the entire file being stored in the database.
            if (files != undefined && files.length > 0) {
              let file = files[0];
              const fileList: File[] = [];

              for (const curFile of files) {
                file ??= curFile;
                fileList.push(curFile);
              }
              const multiFile = foundSource.supportsMultiFile === true && fileList.length > 1;

              setCurrentFile(file);

              const newPlayer = await foundSource.initialize({
                file: multiFile ? undefined : file,
                files: multiFile ? fileList : undefined,
                metricsCollector,
              });
              if (!isCurrentSelection()) {
                await closePlayerForSourceSwitch(newPlayer);
                return;
              }

              if (newPlayer == undefined) {
                throw new Error("Unable to initialize file player");
              }

              commitSourceState();
              installPlayer(newPlayer, { id: sourceId, type: "file" });
              return;
            } else if (handle) {
              const permission = await handle.queryPermission({ mode: "read" });
              if (!isMounted() || !isCurrentSelection()) {
                return;
              }

              if (permission !== "granted") {
                const newPerm = await handle.requestPermission({ mode: "read" });
                if (!isCurrentSelection()) {
                  return;
                }
                if (newPerm !== "granted") {
                  throw new Error(`Permission denied: ${handle.name}`);
                }
              }

              const file = await handle.getFile();
              if (!isMounted() || !isCurrentSelection()) {
                return;
              }

              setCurrentFile(file);

              const newPlayer = await foundSource.initialize({
                file,
                metricsCollector,
              });
              if (!isCurrentSelection()) {
                await closePlayerForSourceSwitch(newPlayer);
                return;
              }

              if (newPlayer == undefined) {
                throw new Error("Unable to initialize file player");
              }

              commitSourceState();
              const recentId = addRecent({
                type: "file",
                title: handle.name,
                sourceId: foundSource.id,
                handle,
              });

              installPlayer(newPlayer, { id: sourceId, type: "file", recentId });
              return;
            }
          }
        }

        enqueueSnackbar("Unable to initialize player", { variant: "error" });
      } catch (error) {
        if (!isCurrentSelection()) {
          return;
        }
        if (isOwnRealtimeReplay && currentPlayerRef.current === previousPlayer) {
          previousPlayer.player.reOpen();
          setDataSource(previousPlayer.dataSource);
        } else {
          commitFailedSource();
        }
        enqueueSnackbar(error instanceof Error ? error.message : "Unable to initialize player", {
          variant: "error",
        });
      }
    },
    [
      playerSources,
      metricsCollector,
      installPlayer,
      setDataSource,
      enqueueSnackbar,
      beforeConnectionSource,
      confirm,
      consoleApi,
      entitlement,
      entitlementDialog,
      retentionWindowMs,
      manifestStorageSource,
      autoConnectToLan,
      addRecent,
      t,
      positiveRequestWindow,
      positiveReadAheadDuration,
      enablePlaybackSpillCache,
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
