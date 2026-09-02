// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useLatest } from "react-use";
import { DeepPartial } from "ts-essentials";
import { useDebouncedCallback } from "use-debounce";

import Logger from "@foxglove/log";
import { toNanoSec } from "@foxglove/rostime";
import {
  Immutable,
  LayoutActions,
  RenderState,
  SettingsTreeAction,
  SettingsTreeNodes,
  Subscription,
  Topic,
} from "@foxglove/studio";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { BuiltinPanelExtensionContext } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import {
  DEFAULT_SCENE_EXTENSION_CONFIG,
  SceneExtensionConfig,
} from "@foxglove/studio-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { playbackPerformanceMetrics } from "@foxglove/studio-base/services/playbackPerformanceTelemetry";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import type {
  FollowMode,
  IRenderer,
  ImageModeConfig,
  RendererConfig,
  RendererSubscription,
  TestOptions,
} from "./IRenderer";
import type { PickedRenderable } from "./Picker";
import { SELECTED_ID_VARIABLE } from "./Renderable";
import { Renderer } from "./Renderer";
import { RendererContext, useRendererEvent, useRendererProperty } from "./RendererContext";
import { RendererOverlay } from "./RendererOverlay";
import { CameraState, DEFAULT_CAMERA_STATE } from "./camera";
import {
  PublishRos1Datatypes,
  PublishRos2Datatypes,
  makePointMessage,
  makePoseEstimateMessage,
  makePoseMessage,
} from "./publish";
import type { LayerSettingsTransform } from "./renderables/FrameAxes";
import { PublishClickEventMap, PublishClickType } from "./renderables/PublishClickTool";
import { DEFAULT_PUBLISH_SETTINGS } from "./renderables/PublishSettings";
import { getTopicMessageFrequencies } from "./topicMessageFrequencies";
import { InterfaceMode } from "./types";

const log = Logger.getLogger(__filename);
const ZOOM_IN_LIMITATION = 1;
const ZOOM_OUT_LIMITATION = 40;
const ZOOM_STEP = 1;

type Shared3DPanelState = {
  cameraState: CameraState;
  followMode: FollowMode;
  followTf: undefined | string;
};

const PANEL_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  position: "relative",
};

function getSelectedTopicMessageFrequency({
  extensionData,
  selectedTopic,
  topics,
}: {
  extensionData: Record<string, unknown> | undefined;
  selectedTopic: string | undefined;
  topics: ReadonlyArray<Topic> | undefined;
}): number | undefined {
  if (selectedTopic == undefined) {
    return undefined;
  }

  const topicMessageFrequencies = getTopicMessageFrequencies(extensionData);
  if (
    topicMessageFrequencies != undefined &&
    Object.prototype.hasOwnProperty.call(topicMessageFrequencies, selectedTopic)
  ) {
    const frequency = topicMessageFrequencies[selectedTopic];
    return typeof frequency === "number" ? frequency : undefined;
  }

  const frequency = topics?.find((topic) => topic.name === selectedTopic)?.messageFrequency;
  return frequency != undefined && frequency > 0 ? frequency : undefined;
}

/** Collapse render states received before the canvas renderer is ready into one consumable tick. */
export function mergeRenderStatesForRenderer(
  previous: Immutable<RenderState> | undefined,
  next: Immutable<RenderState>,
): Immutable<RenderState> {
  if (previous == undefined || next.didSeek === true) {
    return next;
  }

  return {
    ...next,
    allFrames: next.allFrames ?? previous.allFrames,
    currentFrame: [...(previous.currentFrame ?? []), ...(next.currentFrame ?? [])],
    didSeek: previous.didSeek === true,
  };
}

/** A newly-created renderer has no decoder continuity, even when the player did not seek. */
export function renderStateForNewRenderer(
  renderState: Immutable<RenderState>,
): Immutable<RenderState> {
  return renderState.didSeek === true ? renderState : { ...renderState, didSeek: true };
}

/** Detach a panel tick from PanelExtensionAdapter's mutable top-level RenderState builder object. */
export function snapshotRenderState(renderState: Immutable<RenderState>): Immutable<RenderState> {
  return { ...renderState };
}

/** The adapter retains the currentFrame array identity until a new message batch is produced. */
export function currentFrameForRenderTick(
  currentFrame: Immutable<RenderState>["currentFrame"],
  previousCurrentFrame: Immutable<RenderState>["currentFrame"] | symbol,
): Immutable<RenderState>["currentFrame"] {
  return currentFrame === previousCurrentFrame ? undefined : currentFrame;
}

export function configureRendererPlaybackHooks(
  renderer: IRenderer,
  subscribeMessageRange: IRenderer["subscribeMessageRange"],
  acquireSeekKeyframeSearchPlaybackPause: IRenderer["acquireSeekKeyframeSearchPlaybackPause"],
): void {
  renderer.subscribeMessageRange = subscribeMessageRange;
  renderer.acquireSeekKeyframeSearchPlaybackPause = acquireSeekKeyframeSearchPlaybackPause;
}

async function processRenderState(
  renderer: IRenderer,
  renderState: Immutable<RenderState>,
): Promise<void> {
  renderer.startTime = renderState.startTime ? toNanoSec(renderState.startTime) : undefined;
  renderer.setTopics(renderState.topics);
  renderer.setParameters(renderState.parameters);
  renderer.compatibilityMode =
    renderState.appSettings?.get(AppSetting.TF_COMPATIBILITY_MODE) === "true";
  if (renderState.colorScheme != undefined && renderer.colorScheme !== renderState.colorScheme) {
    renderer.setColorScheme(renderState.colorScheme, renderer.config.scene.backgroundColor);
  }

  await renderer.processMessageEvents({
    currentTime: renderState.currentTime,
    didSeek: renderState.didSeek === true,
    allFrames: renderState.allFrames,
    currentFrame: renderState.currentFrame,
  });
}

/** Finish a Player render tick only after its renderer work has settled. */
export async function completeRenderTick({
  work,
  isCurrent,
  animationFrame,
  done,
}: {
  work: Promise<void>;
  isCurrent: () => boolean;
  animationFrame: () => void;
  done: () => void;
}): Promise<void> {
  try {
    await work;
  } finally {
    if (isCurrent()) {
      try {
        animationFrame();
      } finally {
        done();
      }
    }
  }
}

/**
 * A panel that renders a 3D scene. This is a thin wrapper around a `Renderer` instance.
 */
export function ThreeDeeRender(props: {
  context: BuiltinPanelExtensionContext;
  interfaceMode: InterfaceMode;
  testOptions: TestOptions;
  /** Allow for injection or overriding of default extensions by custom extensions */
  customSceneExtensions?: DeepPartial<SceneExtensionConfig>;
}): React.JSX.Element {
  const { context, interfaceMode, testOptions, customSceneExtensions } = props;
  const {
    initialState,
    saveState,
    unstable_fetchAsset: fetchAsset,
    unstable_subscribeMessageRange: subscribeMessageRange,
    unstable_setMessagePathDropConfig: setMessagePathDropConfig,
  } = context;
  const analytics = useAnalytics();

  // Load and save the persisted panel configuration
  const [config, setConfig] = useState<Immutable<RendererConfig>>(() => {
    const partialConfig = initialState as DeepPartial<RendererConfig> | undefined;

    // Initialize the camera from default settings overlaid with persisted settings
    const cameraState: CameraState = _.merge(
      _.cloneDeep(DEFAULT_CAMERA_STATE),
      partialConfig?.cameraState,
    );
    const publish = _.merge(_.cloneDeep(DEFAULT_PUBLISH_SETTINGS), partialConfig?.publish);

    const transforms = (partialConfig?.transforms ?? {}) as Record<
      string,
      Partial<LayerSettingsTransform>
    >;

    return {
      cameraState,
      followMode: partialConfig?.followMode ?? "follow-pose",
      followTf: partialConfig?.followTf,
      scene: partialConfig?.scene ?? {},
      transforms,
      topics: partialConfig?.topics ?? {},
      layers: partialConfig?.layers ?? {},
      synchronize: partialConfig?.synchronize,
      syncedTopics: partialConfig?.syncedTopics ?? {},
      publish,
      // deep partial on config, makes gradient tuple type [string | undefined, string | undefined]
      // which is incompatible with `Partial<ColorModeSettings>`
      imageMode: (partialConfig?.imageMode ?? {}) as Partial<ImageModeConfig>,
    };
  });
  const configRef = useLatest(config);
  const { cameraState } = config;
  const backgroundColor = config.scene.backgroundColor;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | ReactNull>(ReactNull);
  const [renderer, setRenderer] = useState<IRenderer | undefined>(undefined);
  const rendererRef = useRef<IRenderer | undefined>(undefined);
  const rendererTickGenerationRef = useRef(0);
  const pendingRenderStateRef = useRef<Immutable<RenderState> | undefined>(undefined);
  const initialCurrentFrameIdentityRef = useRef(Symbol("initial-current-frame"));
  const lastCurrentFrameIdentityRef = useRef<Immutable<RenderState>["currentFrame"] | symbol>(
    initialCurrentFrameIdentityRef.current,
  );
  const renderDoneCallbacksRef = useRef<Array<() => void>>([]);
  const latestRenderStateRef = useRef<Immutable<RenderState> | undefined>(undefined);
  const rendererReplayRef = useRef<{ renderer: IRenderer; promise: Promise<void> } | undefined>(
    undefined,
  );

  const acquireSeekKeyframeSearchPlaybackPause = useCallback(() => {
    const finishVisualTask = playbackPerformanceMetrics.beginVisualTask();
    const releasePlaybackPause =
      context.unstable_acquireKeyframeSearchLock?.({
        isPlaying: context.unstable_getPlaybackIsPlaying?.() ?? false,
        pausePlayback: context.unstable_pausePlayback,
        startPlayback: context.unstable_startPlayback,
      }) ?? (() => {});
    if (finishVisualTask == undefined) {
      return releasePlaybackPause;
    }
    return () => {
      try {
        releasePlaybackPause();
      } finally {
        finishVisualTask();
      }
    };
  }, [context]);
  const subscribeMessageRangeRef = useLatest(subscribeMessageRange);
  const acquireSeekKeyframeSearchPlaybackPauseRef = useLatest(
    acquireSeekKeyframeSearchPlaybackPause,
  );
  const finishPendingRenderTicks = useCallback(() => {
    const doneCallbacks = renderDoneCallbacksRef.current.splice(0);
    for (const done of doneCallbacks) {
      done();
    }
  }, []);

  const { enqueueSnackbar } = useSnackbar();

  const displayTemporaryError = useCallback(
    (errorString: string) => {
      enqueueSnackbar(errorString, { variant: "error" });
    },
    [enqueueSnackbar],
  );

  useEffect(() => {
    const newRenderer = canvas
      ? new Renderer({
          canvas,
          config: configRef.current,
          interfaceMode,
          fetchAsset,
          sceneExtensionConfig: _.merge(
            {},
            DEFAULT_SCENE_EXTENSION_CONFIG,
            customSceneExtensions ?? {},
          ),
          displayTemporaryError,
          testOptions,
        })
      : undefined;
    if (newRenderer != undefined) {
      configureRendererPlaybackHooks(
        newRenderer,
        subscribeMessageRangeRef.current,
        acquireSeekKeyframeSearchPlaybackPauseRef.current,
      );
    }
    setRenderer(newRenderer);
    rendererRef.current = newRenderer;

    const rendererGeneration = ++rendererTickGenerationRef.current;
    const replayRenderState = pendingRenderStateRef.current ?? latestRenderStateRef.current;
    if (newRenderer != undefined && replayRenderState != undefined) {
      pendingRenderStateRef.current = undefined;
      // Treat the cold renderer as a seek so a delta-only latest tick can recover its GOP from the
      // message range instead of waiting for the next keyframe. Retain the replay Promise so a
      // re-entrant render waits for this initial batch before processing its own messages.
      const replayPromise = Promise.resolve()
        .then(async () => {
          if (rendererRef.current !== newRenderer) {
            return;
          }
          await processRenderState(newRenderer, renderStateForNewRenderer(replayRenderState));
        })
        .catch((error: unknown) => {
          log.error(error);
        });
      rendererReplayRef.current = { renderer: newRenderer, promise: replayPromise };
      void replayPromise.finally(() => {
        if (rendererReplayRef.current?.promise === replayPromise) {
          rendererReplayRef.current = undefined;
        }
        const replayIsCurrent =
          rendererRef.current === newRenderer &&
          rendererTickGenerationRef.current === rendererGeneration;
        try {
          if (replayIsCurrent) {
            newRenderer.animationFrame();
          }
        } finally {
          if (replayIsCurrent) {
            finishPendingRenderTicks();
          }
        }
      });
    }

    return () => {
      newRenderer?.dispose();
      if (rendererRef.current === newRenderer) {
        rendererRef.current = undefined;
      }
      if (rendererReplayRef.current?.renderer === newRenderer) {
        rendererReplayRef.current = undefined;
      }
    };
  }, [
    canvas,
    configRef,
    config.scene.transforms?.enablePreloading,
    customSceneExtensions,
    interfaceMode,
    fetchAsset,
    testOptions,
    displayTemporaryError,
    subscribeMessageRangeRef,
    acquireSeekKeyframeSearchPlaybackPauseRef,
    finishPendingRenderTicks,
  ]);

  // Combined effect for renderer setup operations
  useEffect(() => {
    if (renderer) {
      renderer.setAnalytics(analytics);
    }

    setMessagePathDropConfig(
      renderer
        ? {
            getDropStatus: renderer.getDropStatus,
            handleDrop: renderer.handleDrop,
          }
        : undefined,
    );
  }, [renderer, analytics, setMessagePathDropConfig]);

  const [colorScheme, setColorScheme] = useState<"dark" | "light" | undefined>();
  const [timezone, setTimezone] = useState<string | undefined>();
  const [topics, setTopics] = useState<ReadonlyArray<Topic> | undefined>();
  const [sharedPanelState, setSharedPanelState] = useState<undefined | Shared3DPanelState>();
  const [extensionData, setExtensionData] = useState<Record<string, unknown> | undefined>();

  const schemaSubscriptions = useRendererProperty(
    "schemaSubscriptions",
    "schemaSubscriptionsChanged",
    () => new Map(),
    renderer,
  );
  const topicSubscriptions = useRendererProperty(
    "topicSubscriptions",
    "topicSubscriptionsChanged",
    () => new Map(),
    renderer,
  );

  // Config cameraState
  useEffect(() => {
    const listener = () => {
      if (renderer) {
        const newCameraState = renderer.getCameraState();
        if (!newCameraState) {
          return;
        }
        // This needs to be before `setConfig` otherwise flickering will occur during
        // non-follow mode playback
        renderer.setCameraState(newCameraState);
        setConfig((prevConfig) => ({ ...prevConfig, cameraState: newCameraState }));

        if (config.scene.syncCamera === true) {
          context.setSharedPanelState({
            cameraState: newCameraState,
            followMode: config.followMode,
            followTf: renderer.followFrameId,
          });
        }
      }
    };
    renderer?.addListener("cameraMove", listener);
    return () => void renderer?.removeListener("cameraMove", listener);
  }, [config.scene.syncCamera, config.followMode, context, renderer?.followFrameId, renderer]);

  // Handle user changes in the settings sidebar
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      // Wrapping in unstable_batchedUpdates causes React to run effects _after_ the handleAction
      // function has finished executing. This allows scene extensions that call
      // renderer.updateConfig to read out the new config value and configure their renderables
      // before the render occurs.
      ReactDOM.unstable_batchedUpdates(() => {
        if (renderer) {
          const initialCameraState = renderer.getCameraState();
          renderer.settings.handleAction(action);
          const updatedCameraState = renderer.getCameraState();
          // Communicate camera changes from settings to the global state if syncing.
          if (updatedCameraState !== initialCameraState && config.scene.syncCamera === true) {
            context.setSharedPanelState({
              cameraState: updatedCameraState,
              followMode: config.followMode,
              followTf: renderer.followFrameId,
            });
          }
        }
      });
    },
    [config.followMode, config.scene.syncCamera, context, renderer],
  );

  // Maintain the settings tree
  const [settingsTree, setSettingsTree] = useState<SettingsTreeNodes | undefined>(undefined);
  const updateSettingsTree = useCallback((curRenderer: IRenderer) => {
    setSettingsTree(curRenderer.settings.tree());
  }, []);
  useRendererEvent("settingsTreeChange", updateSettingsTree, renderer);

  // Save the panel configuration when it changes
  const updateConfig = useCallback((curRenderer: IRenderer) => {
    setConfig(curRenderer.config);
  }, []);
  useRendererEvent("configChange", updateConfig, renderer);

  // Write to a global variable when the current selection changes
  const updateSelectedRenderable = useCallback(
    (selection: PickedRenderable | undefined) => {
      const id = selection?.renderable.idFromMessage();
      const customVariable = selection?.renderable.selectedIdVariable();
      if (customVariable) {
        context.setVariable(customVariable, id);
      }
      context.setVariable(SELECTED_ID_VARIABLE, id);
    },
    [context],
  );
  useRendererEvent("selectedRenderable", updateSelectedRenderable, renderer);

  const [focusedSettingsPath, setFocusedSettingsPath] = useState<undefined | readonly string[]>();

  const onShowTopicSettings = useCallback((topic: string) => {
    setFocusedSettingsPath(["topics", topic]);
  }, []);

  // Rebuild the settings sidebar tree as needed
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler,
      enableFilter: true,
      focusedPath: focusedSettingsPath,
      nodes: settingsTree ?? {},
    });
  }, [actionHandler, context, focusedSettingsPath, settingsTree]);

  // Update the renderer's reference to `config` when it changes. Note that this does *not*
  // automatically update the settings tree.
  useEffect(() => {
    if (renderer) {
      renderer.setConfig(config);
      renderer.queueAnimationFrame();
    }
  }, [config, renderer]);

  // Update the renderer's reference to `topics` when it changes
  useEffect(() => {
    if (renderer && renderer.topics !== topics) {
      renderer.setTopics(topics);
      renderer.queueAnimationFrame();
    }
  }, [topics, renderer]);

  // Save panel settings whenever they change
  const throttledSave = useDebouncedCallback(
    (newConfig: Immutable<RendererConfig>) => {
      saveState(newConfig);
    },
    1000,
    { leading: false, trailing: true, maxWait: 1000 },
  );
  useEffect(() => throttledSave(config), [config, throttledSave]);

  // Keep default panel title up to date with selected image topic in image mode
  useEffect(() => {
    if (interfaceMode === "image") {
      context.setDefaultPanelTitle(config.imageMode.imageTopic);
    }
  }, [interfaceMode, context, config.imageMode.imageTopic]);

  // Establish a connection to the message pipeline with context.watch and context.onRender
  useLayoutEffect(() => {
    context.onRender = (renderState: Immutable<RenderState>, done) => {
      const rawRenderStateSnapshot = snapshotRenderState(renderState);
      const currentFrame = currentFrameForRenderTick(
        renderState.currentFrame,
        lastCurrentFrameIdentityRef.current,
      );
      lastCurrentFrameIdentityRef.current = renderState.currentFrame;
      const renderStateSnapshot =
        currentFrame === renderState.currentFrame
          ? rawRenderStateSnapshot
          : { ...rawRenderStateSnapshot, currentFrame };
      const rendererGeneration = ++rendererTickGenerationRef.current;
      const currentRenderer = rendererRef.current;
      // A renderer rebuild needs the adapter's latest retained batch for cold GOP recovery, while
      // the current renderer must consume each currentFrame array identity only once.
      latestRenderStateRef.current = rawRenderStateSnapshot;
      renderDoneCallbacksRef.current.push(done);

      ReactDOM.unstable_batchedUpdates(() => {
        setColorScheme(renderStateSnapshot.colorScheme);
        if (renderStateSnapshot.appSettings) {
          const tz = renderStateSnapshot.appSettings.get(AppSetting.TIMEZONE);
          setTimezone(typeof tz === "string" ? tz : undefined);
        }
        setTopics(renderStateSnapshot.topics);
        setSharedPanelState(renderStateSnapshot.sharedPanelState as Shared3DPanelState);
        setExtensionData(renderStateSnapshot.extensionData);
      });

      if (currentRenderer == undefined) {
        pendingRenderStateRef.current = mergeRenderStatesForRenderer(
          pendingRenderStateRef.current,
          renderStateSnapshot,
        );
        return;
      }

      const rendererReplay = rendererReplayRef.current;
      const work = Promise.resolve()
        .then(async () => {
          if (rendererReplay?.renderer === currentRenderer) {
            await rendererReplay.promise;
          }
          if (rendererRef.current !== currentRenderer) {
            return;
          }
          await processRenderState(currentRenderer, renderStateSnapshot);
        })
        .catch((error: unknown) => {
          log.error(error);
        });
      void completeRenderTick({
        work,
        isCurrent: () =>
          rendererRef.current === currentRenderer &&
          rendererTickGenerationRef.current === rendererGeneration,
        animationFrame: () => {
          currentRenderer.animationFrame();
        },
        done: finishPendingRenderTicks,
      });
    };

    context.watch("allFrames");
    context.watch("colorScheme");
    context.watch("currentFrame");
    context.watch("startTime");
    context.watch("currentTime");
    context.watch("didSeek");
    context.watch("parameters");
    context.watch("sharedPanelState");
    context.watch("topics");
    context.watch("extensionData");
    context.watch("appSettings");
    context.subscribeAppSettings([AppSetting.TIMEZONE, AppSetting.TF_COMPATIBILITY_MODE]);

    return () => {
      context.onRender = undefined;
      finishPendingRenderTicks();
    };
  }, [context, finishPendingRenderTicks]);

  // Build a list of topics to subscribe to
  const [topicsToSubscribe, setTopicsToSubscribe] = useState<Subscription[] | undefined>(undefined);
  useEffect(() => {
    if (!topics) {
      setTopicsToSubscribe(undefined);
      return;
    }

    const newSubscriptions: Subscription[] = [];

    const addSubscription = (
      topic: Topic,
      rendererSubscription: RendererSubscription,
      convertTo?: string,
    ) => {
      let shouldSubscribe = rendererSubscription.shouldSubscribe?.(topic.name);
      if (shouldSubscribe == undefined) {
        if (config.topics[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else if (config.imageMode.annotations?.[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else {
          shouldSubscribe = false;
        }
      }
      if (shouldSubscribe) {
        newSubscriptions.push({
          topic: topic.name,
          preload: rendererSubscription.preload,
          convertTo,
        });
      }
    };

    for (const topic of topics) {
      for (const rendererSubscription of topicSubscriptions.get(topic.name) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const rendererSubscription of schemaSubscriptions.get(topic.schemaName) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const schemaName of topic.convertibleTo ?? []) {
        for (const rendererSubscription of schemaSubscriptions.get(schemaName) ?? []) {
          addSubscription(topic, rendererSubscription, schemaName);
        }
      }
    }

    // Sort the list to make comparisons stable
    newSubscriptions.sort((a, b) => a.topic.localeCompare(b.topic));
    setTopicsToSubscribe((prev) => (_.isEqual(prev, newSubscriptions) ? prev : newSubscriptions));
  }, [
    topics,
    config.topics,
    // Need to update subscriptions when imagemode topics change
    // shouldSubscribe values will be re-evaluated
    config.imageMode.calibrationTopic,
    config.imageMode.imageTopic,
    schemaSubscriptions,
    topicSubscriptions,
    config.imageMode.annotations,
    // Need to update subscriptions when layers change as URDF layers might subscribe to topics
    // shouldSubscribe values will be re-evaluated
    config.layers,
  ]);

  // Notify the extension context when our subscription list changes
  useEffect(() => {
    if (!topicsToSubscribe) {
      return;
    }
    log.debug(`Subscribing to [${topicsToSubscribe.map((t) => JSON.stringify(t)).join(", ")}]`);
    context.subscribe(topicsToSubscribe);
  }, [context, topicsToSubscribe]);

  useEffect(() => {
    if (renderer) {
      renderer.subscribeMessageRange = subscribeMessageRange;
    }
  }, [renderer, subscribeMessageRange]);

  useEffect(() => {
    if (!renderer) {
      return;
    }

    renderer.acquireSeekKeyframeSearchPlaybackPause = acquireSeekKeyframeSearchPlaybackPause;
    return () => {
      if (
        renderer.acquireSeekKeyframeSearchPlaybackPause === acquireSeekKeyframeSearchPlaybackPause
      ) {
        renderer.acquireSeekKeyframeSearchPlaybackPause = undefined;
      }
    };
  }, [acquireSeekKeyframeSearchPlaybackPause, renderer]);

  // Keep the renderer color scheme up to date. onRender normally applies this before drawing;
  // this effect also covers renderer creation between player ticks.
  useEffect(() => {
    if (colorScheme && renderer && renderer.colorScheme !== colorScheme) {
      renderer.setColorScheme(colorScheme, backgroundColor);
      renderer.queueAnimationFrame();
    }
  }, [backgroundColor, colorScheme, renderer]);

  useEffect(() => {
    if (renderer) {
      renderer.setColorScheme(renderer.colorScheme, backgroundColor);
      renderer.queueAnimationFrame();
    }
  }, [backgroundColor, renderer]);

  // Update the renderer when the camera moves
  useEffect(() => {
    if (!_.isEqual(cameraState, renderer?.getCameraState())) {
      renderer?.setCameraState(cameraState);
      renderer?.queueAnimationFrame();
    }
  }, [cameraState, renderer]);

  // Sync camera with shared state, if enabled.
  useEffect(() => {
    if (!renderer || sharedPanelState == undefined || config.scene.syncCamera !== true) {
      return;
    }

    if (sharedPanelState.followMode !== config.followMode) {
      renderer.setCameraSyncError(
        `Follow mode must be ${sharedPanelState.followMode} to sync camera.`,
      );
    } else if (sharedPanelState.followTf !== renderer.followFrameId) {
      renderer.setCameraSyncError(
        `Display frame must be ${sharedPanelState.followTf} to sync camera.`,
      );
    } else {
      const newCameraState = sharedPanelState.cameraState;
      if (!_.isEqual(newCameraState, renderer.getCameraState())) {
        renderer.setCameraState(newCameraState);
        renderer.queueAnimationFrame();
      }
      setConfig((prevConfig) =>
        _.isEqual(prevConfig.cameraState, newCameraState)
          ? prevConfig
          : { ...prevConfig, cameraState: newCameraState },
      );
      renderer.setCameraSyncError(undefined);
    }
  }, [
    config.scene.syncCamera,
    config.followMode,
    renderer,
    renderer?.followFrameId,
    sharedPanelState,
  ]);

  // Create a useCallback wrapper for adding a new panel to the layout, used to open the
  // "Raw Messages" panel from the object inspector
  const addPanel = useCallback(
    (params: Parameters<LayoutActions["addPanel"]>[0]) => {
      context.layout.addPanel(params);
    },
    [context.layout],
  );

  const [measureActive, setMeasureActive] = useState(false);
  useEffect(() => {
    const onStart = () => {
      setMeasureActive(true);
    };
    const onEnd = () => {
      setMeasureActive(false);
    };
    renderer?.measurementTool.addEventListener("foxglove.measure-start", onStart);
    renderer?.measurementTool.addEventListener("foxglove.measure-end", onEnd);
    return () => {
      renderer?.measurementTool.removeEventListener("foxglove.measure-start", onStart);
      renderer?.measurementTool.removeEventListener("foxglove.measure-end", onEnd);
    };
  }, [renderer?.measurementTool]);

  const onClickMeasure = useCallback(() => {
    if (measureActive) {
      renderer?.measurementTool.stopMeasuring();
    } else {
      renderer?.measurementTool.startMeasuring();
      renderer?.publishClickTool.stop();
    }
  }, [measureActive, renderer]);

  const [publishActive, setPublishActive] = useState(false);
  useEffect(() => {
    if (renderer?.publishClickTool.publishClickType !== config.publish.type) {
      renderer?.publishClickTool.setPublishClickType(config.publish.type);
      // stop if we changed types while a publish action was already in progress
      renderer?.publishClickTool.stop();
    }
  }, [config.publish.type, renderer]);

  const publishTopics = useMemo(() => {
    return {
      goal: config.publish.poseTopic,
      point: config.publish.pointTopic,
      pose: config.publish.poseEstimateTopic,
    };
  }, [config.publish.poseTopic, config.publish.pointTopic, config.publish.poseEstimateTopic]);

  useEffect(() => {
    const datatypes =
      context.dataSourceProfile === "ros2" ? PublishRos2Datatypes : PublishRos1Datatypes;
    context.advertise?.(publishTopics.goal, "geometry_msgs/PoseStamped", { datatypes });
    context.advertise?.(publishTopics.point, "geometry_msgs/PointStamped", { datatypes });
    context.advertise?.(publishTopics.pose, "geometry_msgs/PoseWithCovarianceStamped", {
      datatypes,
    });

    return () => {
      context.unadvertise?.(publishTopics.goal);
      context.unadvertise?.(publishTopics.point);
      context.unadvertise?.(publishTopics.pose);
    };
  }, [publishTopics, context, context.dataSourceProfile]);

  const latestPublishConfig = useLatest(config.publish);

  useEffect(() => {
    const onStart = () => {
      setPublishActive(true);
    };
    const onSubmit = (event: PublishClickEventMap["foxglove.publish-submit"]) => {
      const frameId = renderer?.followFrameId;
      if (frameId == undefined) {
        log.warn("Unable to publish, renderFrameId is not set");
        return;
      }
      if (!context.publish) {
        log.error("Data source does not support publishing");
        return;
      }
      if (context.dataSourceProfile !== "ros1" && context.dataSourceProfile !== "ros2") {
        log.warn("Publishing is only supported in ros1 and ros2");
        return;
      }

      try {
        switch (event.publishClickType) {
          case "point": {
            const message = makePointMessage(event.point, frameId);
            context.publish(publishTopics.point, message);
            break;
          }
          case "pose": {
            const message = makePoseMessage(event.pose, frameId);
            context.publish(publishTopics.goal, message);
            break;
          }
          case "pose_estimate": {
            const message = makePoseEstimateMessage(
              event.pose,
              frameId,
              latestPublishConfig.current.poseEstimateXDeviation,
              latestPublishConfig.current.poseEstimateYDeviation,
              latestPublishConfig.current.poseEstimateThetaDeviation,
            );
            context.publish(publishTopics.pose, message);
            break;
          }
        }
      } catch (error) {
        log.info(error);
      }
    };
    const onEnd = () => {
      setPublishActive(false);
    };
    renderer?.publishClickTool.addEventListener("foxglove.publish-start", onStart);
    renderer?.publishClickTool.addEventListener("foxglove.publish-submit", onSubmit);
    renderer?.publishClickTool.addEventListener("foxglove.publish-end", onEnd);
    return () => {
      renderer?.publishClickTool.removeEventListener("foxglove.publish-start", onStart);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-submit", onSubmit);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-end", onEnd);
    };
  }, [
    context,
    latestPublishConfig,
    publishTopics,
    renderer?.followFrameId,
    renderer?.publishClickTool,
  ]);

  const onClickPublish = useCallback(() => {
    if (publishActive) {
      renderer?.publishClickTool.stop();
    } else {
      renderer?.publishClickTool.start();
      renderer?.measurementTool.stopMeasuring();
    }
  }, [publishActive, renderer]);

  const onTogglePerspective = useCallback(() => {
    const currentState = renderer?.getCameraState()?.perspective ?? false;
    actionHandler({
      action: "update",
      payload: {
        input: "boolean",
        path: ["cameraState", "perspective"],
        value: !currentState,
      },
    });
  }, [actionHandler, renderer]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "3" && !(event.metaKey || event.ctrlKey)) {
        onTogglePerspective();
        event.stopPropagation();
        event.preventDefault();
      }
    },
    [onTogglePerspective],
  );

  const onResetCamera = useCallback(() => {
    if (renderer) {
      const currentFollowTf = config.followTf;
      actionHandler({
        action: "update",
        payload: {
          input: "select",
          path: ["general", "followTf"],
          value: "base_link",
        },
      });
      actionHandler({
        action: "update",
        payload: {
          input: "select",
          path: ["general", "followMode"],
          value: "follow-pose",
        },
      });
      setTimeout(() => {
        actionHandler({
          action: "update",
          payload: {
            input: "select",
            path: ["general", "followTf"],
            value: currentFollowTf,
          },
        });
        actionHandler({
          action: "update",
          payload: {
            input: "select",
            path: ["general", "followMode"],
            value: "follow-none",
          },
        });
      }, 100);
      const currentState = renderer.config.cameraState.perspective;
      renderer.updateConfig((draft) => {
        draft.cameraState = {
          ...DEFAULT_CAMERA_STATE,
          perspective: currentState,
        };
      });
    }
  }, [renderer, actionHandler, config.followTf]);

  const onZoomIn = useCallback(() => {
    if (renderer) {
      if (renderer.config.cameraState.distance - ZOOM_STEP < ZOOM_IN_LIMITATION) {
        renderer.updateConfig((draft) => {
          draft.cameraState = {
            ...renderer.config.cameraState,
            distance: ZOOM_IN_LIMITATION,
          };
        });
      } else {
        renderer.updateConfig((draft) => {
          draft.cameraState = {
            ...renderer.config.cameraState,
            distance: renderer.config.cameraState.distance - ZOOM_STEP,
          };
        });
      }
    }
  }, [renderer]);

  const onZoomOut = useCallback(() => {
    if (renderer) {
      if (renderer.config.cameraState.distance + ZOOM_STEP > ZOOM_OUT_LIMITATION) {
        renderer.updateConfig((draft) => {
          draft.cameraState = {
            ...renderer.config.cameraState,
            distance: ZOOM_OUT_LIMITATION,
          };
        });
      } else {
        renderer.updateConfig((draft) => {
          draft.cameraState = {
            ...renderer.config.cameraState,
            distance: renderer.config.cameraState.distance + ZOOM_STEP,
          };
        });
      }
    }
  }, [renderer]);

  // The 3d panel only supports publishing to ros1 and ros2 data sources
  const isRosDataSource =
    context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2";
  const canPublish = context.publish != undefined && isRosDataSource;

  const onChangePublishClickType = useCallback(
    (type: PublishClickType) => {
      renderer?.publishClickTool.setPublishClickType(type);
      renderer?.publishClickTool.start();
    },
    [renderer],
  );

  const selectedImageTopic = interfaceMode === "image" ? config.imageMode.imageTopic : undefined;
  const selectedImageTopicMessageFrequency = useMemo(
    () =>
      getSelectedTopicMessageFrequency({
        extensionData,
        selectedTopic: selectedImageTopic,
        topics,
      }),
    [extensionData, selectedImageTopic, topics],
  );

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <div style={PANEL_STYLE} onKeyDown={onKeyDown}>
        <canvas
          ref={setCanvas}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            ...((measureActive || publishActive) && { cursor: "crosshair" }),
          }}
        />
        <RendererContext.Provider value={renderer}>
          <RendererOverlay
            interfaceMode={interfaceMode}
            canvas={canvas}
            addPanel={addPanel}
            enableStats={config.scene.enableStats ?? false}
            perspective={config.cameraState.perspective}
            onTogglePerspective={onTogglePerspective}
            measureActive={measureActive}
            onClickMeasure={onClickMeasure}
            canPublish={canPublish}
            publishActive={publishActive}
            onClickPublish={onClickPublish}
            onShowTopicSettings={onShowTopicSettings}
            publishClickType={renderer?.publishClickTool.publishClickType ?? "point"}
            onChangePublishClickType={onChangePublishClickType}
            timezone={timezone}
            onResetCamera={onResetCamera}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            selectedImageTopic={selectedImageTopic}
            selectedImageTopicMessageFrequency={selectedImageTopicMessageFrequency}
          />
        </RendererContext.Provider>
      </div>
    </ThemeProvider>
  );
}
