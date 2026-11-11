// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTheme } from "@mui/material";
import { produce } from "immer";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "react-use";
import { v4 as uuid } from "uuid";

import { useSynchronousMountedState, useValueChangedDebugLog } from "@foxglove/hooks";
import Logger from "@foxglove/log";
import { fromSec, toSec } from "@foxglove/rostime";
import type {
  AppSettingValue,
  ExtensionPanelRegistration,
  PanelExtensionContext,
  ParameterValue,
  RenderState,
  SettingsTree,
  SettingsTreeAction,
  Subscription,
  Time,
  VariableValue,
} from "@foxglove/studio";
import type { MessagePipelineContext } from "@foxglove/studio-base/components/MessagePipeline";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import PanelToolbar from "@foxglove/studio-base/components/PanelToolbar";
import { useAppConfiguration } from "@foxglove/studio-base/context/AppConfigurationContext";
import type { ExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import {
  getExtensionPanelSettings,
  useExtensionCatalog,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";
import type { PlaybackInteractionStateStore } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import {
  useClearHoverValue,
  useHoverValue,
  useSetHoverValue,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import useGlobalVariables from "@foxglove/studio-base/hooks/useGlobalVariables";
import type { AdvertiseOptions, SubscribePayload } from "@foxglove/studio-base/players/types";
import { PlayerCapabilities, PlayerPresence } from "@foxglove/studio-base/players/types";
import {
  useDefaultPanelTitle,
  usePanelSettingsTreeUpdate,
} from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { reportError } from "@foxglove/studio-base/reportError";
import type { PanelConfig, SaveConfig } from "@foxglove/studio-base/types/panels";
import { assertNever } from "@foxglove/studio-base/util/assertNever";
import { maybeCast } from "@foxglove/studio-base/util/maybeCast";

import { PanelConfigVersionError } from "./PanelConfigVersionError";
import { PanelRenderLifecycle } from "./PanelRenderLifecycle";
import type { BuilderRenderStateInput, RenderStateConfig } from "./renderState";
import type { BuiltinPanelExtensionContext } from "./types";
import { useSharedPanelState } from "./useSharedPanelState";

const log = Logger.getLogger(__filename);

type VersionedPanelConfig = Record<string, unknown> & { [VERSION_CONFIG_KEY]: number };

export const VERSION_CONFIG_KEY = "foxgloveConfigVersion";

function isVersionedPanelConfig(config: unknown): config is VersionedPanelConfig {
  return (
    config != undefined &&
    typeof config === "object" &&
    VERSION_CONFIG_KEY in config &&
    typeof config[VERSION_CONFIG_KEY] === "number"
  );
}

type PanelExtensionAdapterProps = {
  /** function that initializes the panel extension */
  initPanel:
    | ExtensionPanelRegistration["initPanel"]
    | ((context: BuiltinPanelExtensionContext) => void);
  /**
   * If defined, the highest supported version of config the panel supports.
   * Used to prevent older implementations of a panel from trying to access
   * newer, incompatible versions of the panel's config. Panels should include a
   * numbered foxgloveConfigVersion property in their config to control this.
   */
  highestSupportedConfigVersion?: number;
  config: unknown;
  saveConfig: SaveConfig<unknown>;
  /**
   * Optional extension-specific data that will be available in renderState.extensionData
   * extensionData change will call render function
   * recommend use useMemo to stable extensionData object reference
   */
  extensionData?: Record<string, unknown>;
};

function selectContext(ctx: MessagePipelineContext) {
  return ctx;
}

function selectInstalledMessageConverters(state: ExtensionCatalog) {
  return state.installedMessageConverters;
}

const selectAcquireKeyframeSearchLock = (store: PlaybackInteractionStateStore) =>
  store.acquireKeyframeSearchLock;

type PanelSession = {
  active: boolean;
  previewOwnerId: string;
  lifecycle: PanelRenderLifecycle;
  watchedFields: Set<keyof RenderState>;
  subscriptions: Subscription[];
  appSettings: Map<string, AppSettingValue>;
  advertisements: Map<string, AdvertiseOptions>;
  disposers: Set<() => void>;
  appSettingsDisposers: (() => void)[];
};

function trackResource(session: PanelSession, dispose: () => void): () => void {
  let disposed = false;
  const release = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    session.disposers.delete(release);
    dispose();
  };
  if (session.active && session.lifecycle.isActive()) {
    session.disposers.add(release);
  } else {
    // A subscription can synchronously call user code before returning its release function.
    release();
  }
  return release;
}

function reportCleanupError(error: unknown): void {
  reportError(error instanceof Error ? error : new Error(String(error)));
}
/**
 * PanelExtensionAdapter renders a panel extension via initPanel
 *
 * The adapter creates a PanelExtensionContext and invokes initPanel using the context.
 */
function PanelExtensionAdapter(
  props: React.PropsWithChildren<PanelExtensionAdapterProps>,
): React.JSX.Element {
  const { initPanel, config, saveConfig, highestSupportedConfigVersion, extensionData } = props;

  // Unlike the react data flow, the config is only provided to the panel once on setup.
  // The panel is meant to manage the config and call saveConfig on its own.
  //
  // We store the config in a ref to avoid re-initializing the panel when the react config
  // changes.
  const initialState = useLatest(maybeCast<RenderStateConfig>(config));

  const messagePipelineContext = useMessagePipeline(selectContext);

  const { playerState, setSubscriptions, seekPlayback, sortedTopics } = messagePipelineContext;

  const { capabilities, profile: dataSourceProfile, presence: playerPresence } = playerState;

  const { openSiblingPanel, setMessagePathDropConfig, type: panelName } = usePanelContext();

  const [panelId] = useState(() => uuid());
  const isMounted = useSynchronousMountedState();
  const [error, setError] = useState<Error | undefined>();
  const messageConverters = useExtensionCatalog(selectInstalledMessageConverters);

  const sessionRef = useRef<PanelSession | undefined>(undefined);

  const [slowRender, setSlowRender] = useState(false);
  const [, setDefaultPanelTitle] = useDefaultPanelTitle();

  const { globalVariables, setGlobalVariables } = useGlobalVariables();

  const hoverValue = useHoverValue({
    componentId: `PanelExtensionAdapter:${panelId}`,
    isPlaybackSeconds: true,
  });
  const setHoverValue = useSetHoverValue();
  const clearHoverValue = useClearHoverValue();

  const {
    palette: { mode: colorScheme },
  } = useTheme();

  const appConfiguration = useAppConfiguration();

  // The panel extension context exposes methods on the message pipeline. We don't want
  // the extension context to be re-created when the message pipeline changes since it only
  // needs to act on the latest version of the message pipeline.
  //
  // This getter allows the extension context to remain stable through pipeline changes
  const getMessagePipelineContext = useMessagePipelineGetter();
  const acquireKeyframeSearchLock = usePlaybackInteractionState(selectAcquireKeyframeSearchLock);

  const [sharedPanelState, setSharedPanelState] = useSharedPanelState();

  const messageEvents = useMemo(
    () => messagePipelineContext.messageEventsBySubscriberId.get(panelId),
    [messagePipelineContext.messageEventsBySubscriberId, panelId],
  );

  type SharedRenderInput = Omit<
    BuilderRenderStateInput,
    "appSettings" | "subscriptions" | "watchedFields"
  >;
  const committedInputRef = useRef<SharedRenderInput | undefined>(undefined);
  // Only committed React values may be read by an asynchronous render or a newly mounted root.
  useLayoutEffect(() => {
    committedInputRef.current = {
      colorScheme,
      currentFrame: messageEvents,
      globalVariables,
      hoverValue,
      messageConverters,
      playerState,
      sharedPanelState,
      sortedTopics,
      config: undefined,
      extensionData,
    };
  });

  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const extensionsSettings = useExtensionCatalog(getExtensionPanelSettings);

  // Use refs to store values that change frequently, avoiding dependency chain issues
  const latestPanelSettingsActionHandlerRef = useRef<SettingsTree["actionHandler"]>();
  const extensionsSettingsRef = useRef(extensionsSettings);
  const panelNameRef = useRef(panelName);

  // Keep refs up to date
  useEffect(() => {
    extensionsSettingsRef.current = extensionsSettings;
    panelNameRef.current = panelName;
  }, [extensionsSettings, panelName]);

  // Stable action handler - reference never changes, accesses latest values via refs
  const stableSettingsActionHandler = useMemo(
    () => (action: SettingsTreeAction) => {
      // Call panel's action handler
      latestPanelSettingsActionHandlerRef.current?.(action);

      // Call extension settings handler
      const {
        payload: { path },
      } = action;

      saveConfig(
        produce<{ topics: Record<string, unknown> }>((draft) => {
          const [category, topicName] = path;
          if (category === "topics" && topicName != undefined) {
            extensionsSettingsRef.current[panelNameRef.current]?.[topicName]?.handler(
              action,
              draft.topics[topicName],
            );
          }
        }),
      );
    },
    [saveConfig],
  );

  type PartialPanelExtensionContext = Omit<BuiltinPanelExtensionContext, "panelElement">;

  const createExtensionContext = useCallback(
    (session: PanelSession): PartialPanelExtensionContext => {
      const isActive = () => session.active && session.lifecycle.isActive() && isMounted();
      const settingsActionHandler: SettingsTree["actionHandler"] = (action) => {
        if (isActive()) {
          stableSettingsActionHandler(action);
        }
      };
      const layout: PanelExtensionContext["layout"] = {
        addPanel({ position, type, updateIfExists, getState }) {
          if (!isActive()) {
            return;
          }
          switch (position) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            case "sibling":
              openSiblingPanel({
                panelType: type,
                updateIfExists,
                siblingConfigCreator: (existingConfig) => getState(existingConfig) as PanelConfig,
              });
              return;
            default:
              assertNever(position, `Unsupported position for addPanel: ${position}`);
          }
        },
      };

      return {
        initialState: initialState.current,

        saveState: (state) => {
          if (!isActive()) {
            return;
          }
          saveConfig(state);
        },

        layout,

        metadata: getMessagePipelineContext().getMetadata(),

        seekPlayback: seekPlayback
          ? (stamp: number | Time) => {
              if (!isActive()) {
                return;
              }
              const seekTarget = typeof stamp === "object" ? stamp : fromSec(stamp);
              seekPlayback(seekTarget);
            }
          : undefined,

        unstable_getPlaybackIsPlaying: () =>
          isActive() && getMessagePipelineContext().playerState.activeData?.isPlaying === true,

        unstable_acquireKeyframeSearchLock: (args) => {
          if (!isActive()) {
            return () => {};
          }
          return trackResource(session, acquireKeyframeSearchLock(args));
        },

        unstable_pausePlayback: () => {
          if (!isActive()) {
            return;
          }
          getMessagePipelineContext().pausePlayback?.();
        },

        unstable_startPlayback: () => {
          if (!isActive()) {
            return;
          }
          getMessagePipelineContext().startPlayback?.();
        },

        dataSourceProfile,

        setParameter: (name: string, value: ParameterValue) => {
          if (!isActive()) {
            return;
          }
          getMessagePipelineContext().setParameter(name, value);
        },

        setVariable: (name: string, value: VariableValue) => {
          if (!isActive()) {
            return;
          }
          setGlobalVariables({ [name]: value });
        },

        setPreviewTime: (stamp: number | undefined) => {
          if (!isActive()) {
            return;
          }
          if (stamp == undefined) {
            clearHoverValue(session.previewOwnerId);
          } else {
            const ctx = getMessagePipelineContext();
            const startTime = ctx.playerState.activeData?.startTime;
            // if we don't have a start time we cannot correctly set the playback seconds hover value
            // this hover value needs seconds from start
            if (!startTime) {
              return;
            }
            const secondsFromStart = stamp - toSec(startTime);
            setHoverValue({
              type: "PLAYBACK_SECONDS",
              componentId: session.previewOwnerId,
              value: secondsFromStart,
              absoluteSeconds: stamp,
            });
          }
        },

        setSharedPanelState: (state) => {
          if (isActive()) {
            setSharedPanelState(state);
          }
        },

        watch: (field: keyof RenderState) => {
          if (!isActive()) {
            return;
          }
          if (!session.watchedFields.has(field)) {
            session.watchedFields.add(field);
            session.lifecycle.requestRender();
          }
        },

        subscribe: (topics: ReadonlyArray<string | Subscription>) => {
          if (!isActive()) {
            return;
          }
          const subscribePayloads = topics.map((item): SubscribePayload => {
            if (typeof item === "string") {
              // For backwards compatability with the topic-string-array api `subscribe(["/topic"])`
              // results in a topic subscription with full preloading
              return { topic: item, preloadType: "full" };
            }

            return {
              topic: item.topic,
              preloadType: item.preload === true ? "full" : "partial",
            };
          });

          // ExtensionPanel-Facing subscription type
          const localSubs = topics.map((item): Subscription => {
            if (typeof item === "string") {
              return { topic: item, preload: true };
            }

            return item;
          });

          session.subscriptions = localSubs;
          setSubscriptions(panelId, subscribePayloads);
          session.lifecycle.requestRender();
        },

        advertise: capabilities.includes(PlayerCapabilities.advertise)
          ? (topic: string, datatype: string, options) => {
              if (!isActive()) {
                return;
              }
              const payload: AdvertiseOptions = {
                topic,
                schemaName: datatype,
                options,
              };
              session.advertisements.set(topic, payload);

              getMessagePipelineContext().setPublishers(
                panelId,
                Array.from(session.advertisements.values()),
              );
            }
          : undefined,

        unadvertise: capabilities.includes(PlayerCapabilities.advertise)
          ? (topic: string) => {
              if (!isActive()) {
                return;
              }
              session.advertisements.delete(topic);
              getMessagePipelineContext().setPublishers(
                panelId,
                Array.from(session.advertisements.values()),
              );
            }
          : undefined,

        publish: capabilities.includes(PlayerCapabilities.advertise)
          ? (topic, message) => {
              if (!isActive()) {
                return;
              }
              getMessagePipelineContext().publish({
                topic,
                msg: message as Record<string, unknown>,
              });
            }
          : undefined,

        callService: capabilities.includes(PlayerCapabilities.callServices)
          ? async (service, request): Promise<unknown> => {
              if (!isActive()) {
                throw new Error("Service call after panel was unmounted");
              }
              return await getMessagePipelineContext().callService(service, request);
            }
          : undefined,

        unstable_fetchAsset: async (uri, options) => {
          if (!isActive()) {
            throw new Error("Asset fetch after panel was unmounted");
          }
          return await getMessagePipelineContext().fetchAsset(uri, options);
        },

        unstable_subscribeMessageRange: (args) => {
          if (!isActive()) {
            return undefined;
          }
          const release = getMessagePipelineContext().subscribeMessageRange?.({
            ...args,
            onNewRangeIterator: (iterator): void | Promise<void> => {
              if (isActive()) {
                return args.onNewRangeIterator(iterator);
              }
            },
          });
          return release ? trackResource(session, release) : undefined;
        },

        unsubscribeAll: () => {
          if (!isActive()) {
            return;
          }
          session.subscriptions = [];
          setSubscriptions(panelId, []);
          session.lifecycle.requestRender();
        },

        subscribeAppSettings: (settings: string[]) => {
          if (!isActive()) {
            return;
          }
          for (const release of session.appSettingsDisposers) {
            release();
          }
          session.appSettingsDisposers = [];
          session.appSettings = new Map();
          for (const key of new Set(settings)) {
            session.appSettings.set(key, appConfiguration.get(key));
            const handler = (value: AppSettingValue) => {
              if (!isActive()) {
                return;
              }
              session.appSettings = new Map(session.appSettings).set(key, value);
              session.lifecycle.requestRender();
            };
            appConfiguration.addChangeListener(key, handler);
            session.appSettingsDisposers.push(
              trackResource(session, () => {
                appConfiguration.removeChangeListener(key, handler);
              }),
            );
          }
          session.lifecycle.requestRender();
        },

        updatePanelSettingsEditor: (settings: SettingsTree) => {
          if (!isActive()) {
            return;
          }
          // Store the panel's action handler in ref for stable wrapper to call
          latestPanelSettingsActionHandlerRef.current = settings.actionHandler;
          // Use stable action handler to prevent unnecessary re-renders of settings tree
          updatePanelSettingsTree({
            ...settings,
            actionHandler: settingsActionHandler,
          });
        },

        setDefaultPanelTitle: (title: string) => {
          if (!isActive()) {
            return;
          }
          setDefaultPanelTitle(title);
        },

        unstable_setMessagePathDropConfig(dropConfig) {
          if (!isActive()) {
            return;
          }
          setMessagePathDropConfig(
            dropConfig && {
              getDropStatus: (paths) =>
                isActive() ? dropConfig.getDropStatus(paths) : { canDrop: false },
              handleDrop: (paths) => {
                if (isActive()) {
                  dropConfig.handleDrop(paths);
                }
              },
            },
          );
        },
      };
    },
    [
      initialState,
      appConfiguration,
      seekPlayback,
      dataSourceProfile,
      setSharedPanelState,
      capabilities,
      isMounted,
      openSiblingPanel,
      saveConfig,
      stableSettingsActionHandler,
      getMessagePipelineContext,
      acquireKeyframeSearchLock,
      setGlobalVariables,
      clearHoverValue,
      setHoverValue,
      setSubscriptions,
      panelId,
      updatePanelSettingsTree,
      setDefaultPanelTitle,
      setMessagePathDropConfig,
    ],
  );

  const panelContainerRef = useRef<HTMLDivElement>(ReactNull);

  useValueChangedDebugLog(initPanel, "initPanel");
  useValueChangedDebugLog(panelId, "panelId");
  useValueChangedDebugLog(createExtensionContext, "createExtensionContext");

  const configTooNew = useMemo(() => {
    return (
      isVersionedPanelConfig(config) &&
      highestSupportedConfigVersion != undefined &&
      config[VERSION_CONFIG_KEY] > highestSupportedConfigVersion
    );
  }, [config, highestSupportedConfigVersion]);

  const playerIsInitializing = playerPresence === PlayerPresence.INITIALIZING;

  // Manage extension lifecycle by calling initPanel() when the panel context changes.
  //
  // If we useEffect here instead of useLayoutEffect, the prevRenderState can get polluted with data
  // from a previous panel instance.
  useLayoutEffect(() => {
    if (!panelContainerRef.current) {
      throw new Error("Expected panel container to be mounted");
    }

    // Also don't show panel when the player is initializing. The initializing state is temporary for
    // players to go through to load their sources. Once a player has completed initialization `initPanel` is called again (or even a few times),
    // because parts of the player context have changed. This cleans up the old panel that was present
    // during initialization. So there can be no state held between extension panels between initialization and
    // whatever follows it. To prevent this unnecessary render, we do not render the panel during initialization.
    if (configTooNew || playerIsInitializing) {
      return;
    }

    setSlowRender(false);
    setError(undefined);
    const panelElement = document.createElement("div");
    panelElement.style.width = "100%";
    panelElement.style.height = "100%";
    panelElement.style.overflow = "hidden";
    panelContainerRef.current.appendChild(panelElement);

    const session: PanelSession = {
      active: true,
      previewOwnerId: `PanelExtensionAdapter:${uuid()}`,
      watchedFields: new Set(),
      subscriptions: [],
      appSettings: new Map(),
      advertisements: new Map(),
      disposers: new Set(),
      appSettingsDisposers: [],
      lifecycle: new PanelRenderLifecycle({
        getInput: () => ({
          ...committedInputRef.current!,
          watchedFields: session.watchedFields,
          subscriptions: session.subscriptions,
          appSettings: session.appSettings,
        }),
        pauseFrame: () => getMessagePipelineContext().pauseFrame(panelId),
        onError: (err) => {
          if (sessionRef.current === session) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onSlowRender: (slow) => {
          if (session.active && sessionRef.current === session) {
            setSlowRender(slow === "busy");
          }
        },
      }),
    };
    sessionRef.current = session;
    let onUnmount: void | (() => void);
    const dispose = () => {
      if (!session.active) {
        return;
      }
      const releaseResource = (release: () => void) => {
        try {
          release();
        } catch (err) {
          reportCleanupError(err);
        }
      };
      // Retire the public context before running any user cleanup. An old root or asynchronous
      // callback must not publish, resubscribe, or overwrite the next instance's state.
      session.active = false;
      releaseResource(() => {
        clearHoverValue(session.previewOwnerId);
      });
      releaseResource(() => {
        session.lifecycle.dispose();
      });
      if (sessionRef.current === session) {
        sessionRef.current = undefined;
        latestPanelSettingsActionHandlerRef.current = undefined;
        releaseResource(() => {
          setMessagePathDropConfig(undefined);
        });
      }
      for (const release of session.disposers) {
        releaseResource(release);
      }
      session.disposers.clear();
      session.advertisements.clear();
      releaseResource(() => {
        getMessagePipelineContext().setSubscriptions(panelId, []);
      });
      releaseResource(() => {
        getMessagePipelineContext().setPublishers(panelId, []);
      });
      // React roots cannot synchronously unmount inside another root's commit. Keep this at the
      // adapter boundary so built-in panels and third-party React panels have identical behavior.
      queueMicrotask(() => {
        try {
          onUnmount?.();
        } catch (err) {
          reportCleanupError(err);
        } finally {
          panelElement.remove();
        }
      });
    };
    log.info(`Init panel ${panelId}`);
    try {
      onUnmount = initPanel({
        panelElement,
        ...createExtensionContext(session),
        // eslint-disable-next-line no-restricted-syntax
        set onRender(renderFunction: PanelExtensionContext["onRender"]) {
          if (session.active) {
            session.lifecycle.setRenderFunction(renderFunction);
          }
        },
      });
      session.lifecycle.start();
    } catch (err) {
      dispose();
      setError(err instanceof Error ? err : new Error(String(err)));
    }
    return dispose;
  }, [
    initPanel,
    panelId,
    createExtensionContext,
    getMessagePipelineContext,
    configTooNew,
    playerIsInitializing,
    playerState.playerId,
    setMessagePathDropConfig,
    clearHoverValue,
  ]);

  useLayoutEffect(() => {
    sessionRef.current?.lifecycle.requestRender();
  });

  const style: CSSProperties = {};
  if (slowRender) {
    style.borderColor = "orange";
    style.borderWidth = "1px";
    style.borderStyle = "solid";
  }

  if (error) {
    throw error;
  }

  return (
    <div
      style={{
        alignItems: "stretch",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
        zIndex: 0,
        ...style,
      }}
    >
      <PanelToolbar />
      {configTooNew && <PanelConfigVersionError />}
      {props.children}
      <div style={{ flex: 1, overflow: "hidden" }} ref={panelContainerRef} />
    </div>
  );
}

export default PanelExtensionAdapter;
