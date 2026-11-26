// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";

import { cameraStepTarget } from "../cameraFrames";
import { SegmentationError } from "../errors";
import {
  imageFrameIdentity,
  segmentationSourceKey,
  type SegmentationImageMetadata,
  type SegmentationPanelBridge,
} from "../imageSource";
import { createLiveSegmentationService } from "../liveService";
import { isSegmentationRecordName } from "../recordName";
import {
  activateSegmentationRuntime,
  createSegmentationRuntime,
  type SegmentationRuntime,
  type SegmentationSurface,
} from "../runtime";
import { useSegmentationHost, useSegmentationSession } from "../segmentationHostContext";
import { ensureSegmentationProfile, needsSegmentationProfileCheck } from "../segmentationProfile";
import {
  SEGMENTATION_WINDOW_SEC,
  segmentationWindow,
  previewWindowNeedsLoad,
  previewWindowStartSec,
} from "../segmentationWindow";
import type { SegmentationService } from "../service";
import {
  SOURCE_FRAME_WINDOW_NS,
  createSourceFrameLoader,
  framesFromStamps,
  readStamps,
  type SourceFrameLoader,
} from "../sourceFrames";
import type { SegmentationDocument } from "../types";
import { SegmentationPreview } from "./SegmentationPreview";
import { removeSegmentationSurface } from "./surfaceHandoff";

export type SegmentationImageEntryActions = {
  enterInline: () => void;
  enterMaximize: () => void;
};

type Binding = {
  runtime: SegmentationRuntime;
  key: string;
  videoId: string;
  /** Lists this camera's frames from the data source. Absent when the player cannot list ranges. */
  frames?: SourceFrameLoader;
  /** Removes `frames` from the host's registry. */
  unbindFrames?: () => void;
};

function receivedFrameStamps(
  messages: readonly {
    topic: string;
    message: unknown;
    receiveTime: SegmentationImageMetadata["receiveTime"];
  }[],
  topic: string,
): Map<
  string,
  {
    timestamp: SegmentationImageMetadata["timestamp"];
    receiveTime: SegmentationImageMetadata["receiveTime"];
  }
> {
  const stamps = new Map<
    string,
    {
      timestamp: SegmentationImageMetadata["timestamp"];
      receiveTime: SegmentationImageMetadata["receiveTime"];
    }
  >();
  for (const message of messages) {
    if (message.topic !== topic) {
      continue;
    }
    const value = message.message as {
      timestamp?: SegmentationImageMetadata["timestamp"];
      header?: { stamp: SegmentationImageMetadata["timestamp"] };
    };
    const stamp = {
      timestamp: value.header?.stamp ?? value.timestamp ?? message.receiveTime,
      receiveTime: message.receiveTime,
    };
    stamps.set(imageFrameIdentity(stamp), stamp);
  }
  return stamps;
}

/** Source metadata for one camera of the open recording, before any annotation is read. */
function sourceDocument(source: {
  recordId: string;
  recordName: string;
  videoId: string;
  topic: string;
  /** The topic's decoded source size, never the panel canvas size: masks decode against it. */
  image?: Pick<SegmentationImageMetadata, "imageWidth" | "imageHeight">;
  durationSec: number;
  sizeBytes: number;
  frames: SegmentationDocument["frames"];
}): SegmentationDocument {
  return {
    record: { id: source.recordId, name: source.recordName },
    videos: [
      {
        id: source.videoId,
        recordId: source.recordId,
        name: source.topic,
        topic: source.topic,
        width: source.image?.imageWidth,
        height: source.image?.imageHeight,
        durationSec: source.durationSec,
        fps: 0,
        sizeBytes: source.sizeBytes,
        mediaUrl: "",
      },
    ],
    frames: source.frames,
    classes: [],
    instances: [],
    annotations: {},
    annotationSummaries: {},
  };
}

function propagationLocksContext(status: string): boolean {
  return status === "running" || status === "stopping";
}

const useStyles = makeStyles()((theme) => ({
  error: {
    position: "absolute",
    top: theme.spacing(4.25),
    right: theme.spacing(1.25),
    zIndex: 6,
    maxWidth: `min(420px, calc(100% - ${theme.spacing(2.5)}))`,
    padding: theme.spacing(0.75, 1.125),
    border: `1px solid ${theme.palette.error.main}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.error.dark, 0.9),
    color: theme.palette.error.contrastText,
  },
}));

export function SegmentationImageEntry({
  containerRef,
  bridge,
  topic,
  panelId,
  onMaximize,
  onActionsChange,
  onAvailabilityChange,
  service: injectedService,
}: {
  containerRef: RefObject<ReactNull | HTMLDivElement>;
  /** This panel's renderer: its displayed image, camera and cached frames. */
  bridge: SegmentationPanelBridge;
  topic?: string;
  panelId: string;
  onMaximize: () => void;
  /** When set, entry actions are hosted by the panel toolbar instead of a floating overlay. */
  onActionsChange: (actions: SegmentationImageEntryActions | undefined) => void;
  onAvailabilityChange?: (state: "available" | "hidden") => void;
  /**
   * Annotation client override, for tests and fixtures. Omitted, the panel creates the live
   * AnnotationService client for the open cloud record.
   */
  service?: SegmentationService;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const host = useSegmentationHost();
  const { sidebarActions } = useWorkspaceActions();
  const getPipeline = useMessagePipelineGetter();
  // Narrow selectors: the full player state changes on every streamed message.
  const playerName = useMessagePipeline((state) => state.playerState.name);
  const playerUrlState = useMessagePipeline((state) => state.playerState.urlState);
  const playerId = useMessagePipeline((state) => state.playerState.playerId);
  const lastSeekTime = useMessagePipeline((state) => state.playerState.activeData?.lastSeekTime);
  const isPlaying = useMessagePipeline((state) => state.playerState.activeData?.isPlaying);
  const previewWindowStart = useMessagePipeline((state) => {
    const data = state.playerState.activeData;
    return previewWindowStartSec(
      data ? Number(toNanoSec(data.currentTime) - toNanoSec(data.startTime)) / 1e9 : Number.NaN,
    );
  });
  const cachedBlocks = useMessagePipeline(
    (state) => state.playerState.progress.messageCache?.blocks.length ?? 0,
  );
  const record = useCoreData((store) => store.record.value);
  const userId = useCurrentUser((store) => store.user?.userId);
  const recordName = record?.name;
  const backendKey = injectedService ? "injected" : "live";
  // Annotations live only in the AnnotationService: a source without a cloud record has none.
  // The live client comes from the console API so it shares its session (and desktop sign-out).
  const consoleApi = useContext(CoSceneConsoleApiContext);
  const annotatable = injectedService != undefined || isSegmentationRecordName(recordName);
  const createService = useCallback(
    (startNs: bigint, document: SegmentationDocument): SegmentationService | undefined =>
      injectedService ??
      createLiveSegmentationService({ consoleApi, recordName, startNs, document }),
    [consoleApi, injectedService, recordName],
  );
  const userKey = userId ?? "anonymous";
  const appConfiguration = useContext(AppConfigurationContext);
  /** One runtime per user, recording and backend, shared by every camera panel. */
  const createSourceRuntime = useCallback(
    (document: SegmentationDocument, startNs: bigint) => {
      const service = createService(startNs, document);
      if (!service) {
        // Callers check `annotatable` first, which holds exactly when a service exists.
        throw new SegmentationError("errorNeedsCloudRecord");
      }
      return createSegmentationRuntime(service, document, {
        seek: (logTimeNs) => {
          host.session.getState().seek?.(logTimeNs);
        },
        ...(appConfiguration
          ? {
              creationToolSetting: {
                get: () => appConfiguration.get(AppSetting.SEGMENTATION_CREATION_TOOL),
                set: (tool) => {
                  void appConfiguration.set(AppSetting.SEGMENTATION_CREATION_TOOL, tool);
                },
              },
            }
          : {}),
      });
    },
    [appConfiguration, createService, host],
  );
  // The panel holds the runtime of the record it shows; unmounting lets the registry dispose it.
  useEffect(
    () => () => {
      host.registry.release(panelId);
    },
    [host, panelId],
  );
  // The open record is Core Data. A second file in that record is a different playback URL,
  // not a second name on the record, so the title must not hide the URL.
  const dataAssetName = record?.name;
  const active = useRef<Binding | undefined>(undefined);
  const sessionOpen = useSegmentationSession((session) => session.open);
  // Only an open session re-syncs on every clock change; the read-only preview moves by window.
  const sessionClock = useMessagePipeline((state) =>
    sessionOpen ? state.playerState.activeData?.currentTime : undefined,
  );
  const sessionRuntime = useSegmentationSession((session) =>
    session.open ? session.runtime : undefined,
  );
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const blockedImage = useRef<object | undefined>(undefined);
  const lastSyncedImage = useRef<object | undefined>(undefined);
  // What the last source registration read; see `sync`.
  const registeredImage = useRef<
    | {
        image: object;
        bindingKey: string;
        runtime: object;
        blocks: unknown;
        blockMessages: number;
        messages: unknown;
        canvasFrames: number;
      }
    | undefined
  >(undefined);
  const { t } = useTranslation("segmentation");
  // A message key is translated when rendered, so a language change updates a shown alert.
  const [error, setError] = useState<
    | { key: "frameSourceMissing" | "cloudRecordsOnly" | "waitForDecode" | "waitForStop" }
    | { text: string }
  >();
  // Errors raised while a session was open (frame sync runs every frame) are hidden until it
  // closes; drop them then so ending the session does not surface a stale alert.
  useEffect(() => {
    if (sessionRuntime == undefined) {
      setError(undefined);
    }
  }, [sessionRuntime]);
  // Bumped when the first decoded frame arrives after the preview effect found none.
  const [previewRetry, setPreviewRetry] = useState(0);
  const recordId = segmentationSourceKey({
    dataAssetName,
    filename: playerName,
    urlState: playerUrlState,
    playerId,
  });
  const mediaIdentity = playerUrlState?.parameters?.url ?? playerName;
  const bindingKey = JSON.stringify([userKey, playerId, recordId, mediaIdentity, topic])!;
  const previousKey = useRef(bindingKey);
  const previousSeek = useRef(lastSeekTime);
  const latestKey = useRef(bindingKey);
  latestKey.current = bindingKey;
  const rawCapture = useCallback(() => bridge.sources()?.image(), [bridge]);
  const capture = useCallback(() => {
    const image = rawCapture();
    return image?.decodedIdentity === blockedImage.current ? undefined : image;
  }, [rawCapture]);
  /**
   * Identity, size and projection of the displayed frame without its pixels. Render, the preview
   * and entry use this; only an open editing session encodes the frame as a PNG.
   */
  const captureMetadata = useCallback((): SegmentationImageMetadata | undefined => {
    const image = bridge.sources()?.imageMetadata();
    return image?.decodedIdentity === blockedImage.current ? undefined : image;
  }, [bridge]);

  const previewCanStart = cachedBlocks > 0 || captureMetadata() != undefined;
  useEffect(() => {
    // Lets the tree's mini timelines move the shared clock. Any mounted panel can provide it.
    const seek = (logTimeNs: bigint) => {
      getPipeline().seekPlayback?.(fromNanoSec(logTimeNs));
    };
    host.session.setState({ seek });
    return () => {
      if (host.session.getState().seek === seek) {
        host.session.setState({ seek: undefined });
      }
    };
  }, [getPipeline, host]);
  useEffect(() => {
    if (!annotatable || topic == undefined || sessionOpen || previewWindowStart == undefined) {
      return;
    }
    const pipeline = getPipeline();
    const data = pipeline.playerState.activeData;
    const image = captureMetadata();
    const retryOnFrame = () => {
      // Seeking runs this before the panel decoded its frame. Retry once one is displayed.
      const unsubscribe = bridge.subscribeFrames(() => {
        unsubscribe();
        setPreviewRetry((count) => count + 1);
      });
      return unsubscribe;
    };
    if (!data) {
      return retryOnFrame();
    }
    const cached = [
      ...(pipeline.playerState.progress.messageCache?.blocks.flatMap(
        (block) => block?.messagesByTopic[topic] ?? [],
      ) ?? []),
      ...data.messages.filter((message) => message.topic === topic),
    ];
    if (!image && cached.length === 0) {
      return retryOnFrame();
    }
    const epoch = ++previewGeneration.current;
    const gate = { stop: false };
    const listing = new AbortController();
    const superseded = () =>
      gate.stop || epoch !== previewGeneration.current || host.session.getState().open;
    host.session.setState({ previewLoading: true });
    void (async () => {
      try {
        const stableRecordId = segmentationSourceKey({
          dataAssetName,
          filename: pipeline.playerState.name,
          urlState: pipeline.playerState.urlState,
          playerId: pipeline.playerState.playerId,
        });
        const videoId = JSON.stringify([stableRecordId, mediaIdentity, topic])!;
        const sessionKey = JSON.stringify([userKey, stableRecordId, backendKey])!;
        const startNs = toNanoSec(data.startTime);
        const durationSec = Number(toNanoSec(data.endTime) - startNs) / 1e9;
        const stamps = new Map<string, SegmentationImageMetadata>();
        for (const message of cached) {
          const value = message.message as {
            timestamp?: SegmentationImageMetadata["timestamp"];
            header?: { stamp: SegmentationImageMetadata["timestamp"] };
          };
          const timestamp = value.header?.stamp ?? value.timestamp ?? message.receiveTime;
          const stamp: SegmentationImageMetadata = {
            topic,
            timestamp,
            receiveTime: message.receiveTime,
            decodedIdentity: message,
          };
          stamps.set(imageFrameIdentity(stamp), stamp);
        }
        if (image) {
          stamps.set(imageFrameIdentity(image), image);
        }
        // The message cache rarely holds compressed video, so list this window's frames from the
        // source (message times only), as an annotation session does. Without them, a camera whose
        // window was never opened in a session has no frame identity, and so no masks.
        const subscribeMessageRange = pipeline.subscribeMessageRange;
        if (subscribeMessageRange != undefined) {
          const endNs = toNanoSec(data.endTime);
          const fromNs = startNs + BigInt(previewWindowStart) * 1_000_000_000n;
          const toNs = fromNs + SOURCE_FRAME_WINDOW_NS - 1n;
          try {
            const listed = await readStamps(
              subscribeMessageRange,
              topic,
              fromNanoSec(fromNs),
              fromNanoSec(toNs < endNs ? toNs : endNs),
              listing.signal,
            );
            for (const item of listed) {
              const stamp: SegmentationImageMetadata = {
                topic,
                ...item,
                decodedIdentity: item,
              };
              const key = imageFrameIdentity(stamp);
              if (!stamps.has(key)) {
                stamps.set(key, stamp);
              }
            }
          } catch {
            // Cancelled or unsupported: the cached and displayed frames still register.
          }
          if (superseded()) {
            if (!gate.stop && epoch === previewGeneration.current) {
              host.session.setState({ previewLoading: false });
            }
            return;
          }
        }
        const document = sourceDocument({
          recordId: stableRecordId,
          recordName: pipeline.playerState.name ?? t("currentMedia"),
          videoId,
          topic,
          image,
          durationSec,
          sizeBytes: 0,
          frames: framesFromStamps(videoId, startNs, stamps.values()),
        });
        const { runtime, created } = host.registry.acquire(sessionKey, panelId, () =>
          createSourceRuntime(document, startNs),
        );
        if (!created) {
          runtime.registerSource(document);
        }
        await runtime.initialize();
        if (superseded()) {
          if (!gate.stop && epoch === previewGeneration.current) {
            host.session.setState({ previewLoading: false });
          }
          return;
        }
        const state = runtime.store.getState();
        const frames = state.document?.frames.filter((item) => item.videoId === videoId) ?? [];
        // Every camera panel loads its own window into the shared preview runtime. The foreground
        // load aborts any other in flight (and `loading` would skip the rest), so all but one camera
        // would stay empty; the background read runs per window, concurrently.
        if (
          previewWindowNeedsLoad(
            frames,
            (frame) => state.isFrameReady(frame.id),
            previewWindowStart,
            durationSec,
          )
        ) {
          const { startSec, endSec } = segmentationWindow(previewWindowStart, durationSec);
          await state.prefetchFrameWindow(videoId, startSec, endSec);
        }
        if (superseded()) {
          if (!gate.stop && epoch === previewGeneration.current) {
            host.session.setState({ previewLoading: false });
          }
          return;
        }
        host.session.setState({ previewRuntime: runtime, previewLoading: false });
      } catch {
        if (!gate.stop && epoch === previewGeneration.current) {
          host.session.setState({ previewLoading: false });
        }
      }
    })();
    return () => {
      gate.stop = true;
      listing.abort();
      host.session.setState({ previewLoading: false });
    };
  }, [
    host,
    t,
    annotatable,
    previewCanStart,
    captureMetadata,
    bridge,
    dataAssetName,
    getPipeline,
    mediaIdentity,
    panelId,
    previewWindowStart,
    previewRetry,
    sessionOpen,
    topic,
    userId,
    userKey,
    createSourceRuntime,
    backendKey,
  ]);

  const close = useCallback(() => {
    ++generation.current;
    const binding = active.current;
    active.current = undefined;
    binding?.unbindFrames?.();
    binding?.frames?.dispose();
    const ownsSession =
      binding != undefined &&
      host.session.getState().runtime === binding.runtime &&
      host.session.getState().panelId === panelId;
    const remaining = { ...host.session.getState().surfaces };
    delete remaining[panelId];
    const nextPanelId = Object.keys(remaining)[0];
    const handoff = ownsSession && nextPanelId != undefined;
    if (binding != undefined && ownsSession && !handoff) {
      if (propagationLocksContext(binding.runtime.store.getState().propagation.status)) {
        binding.runtime.store.getState().stopPropagation();
      }
      binding.runtime.store.setState({ editing: false, drawing: undefined });
    } else if (
      binding != undefined &&
      handoff &&
      binding.runtime.store.getState().drawing != undefined
    ) {
      binding.runtime.store.setState({ drawing: undefined });
    }
    removeSegmentationSurface(host.session, panelId, ownsSession ? binding.runtime : undefined);
  }, [host, panelId]);

  // Fence before paint: no new-source callback may write into the previous record's runtime.
  useLayoutEffect(() => {
    if (previousKey.current !== bindingKey) {
      blockedImage.current = lastSyncedImage.current ?? rawCapture()?.decodedIdentity;
      previousKey.current = bindingKey;
    }
    close();
    return close;
  }, [bindingKey, close, rawCapture]);

  useEffect(() => {
    if (!sessionRuntime && active.current) {
      close();
    }
  }, [sessionRuntime, close]);

  const sync = useCallback(() => {
    const binding = active.current;
    const session = host.session.getState();
    if (!binding) {
      return;
    }
    if (binding.key !== latestKey.current || !session.open || session.runtime !== binding.runtime) {
      return;
    }
    const focused = session.panelId === panelId;
    const publish = (surface: SegmentationSurface) => {
      host.session.setState((current) => {
        const previous = current.surfaces[panelId];
        const next: SegmentationSurface = {
          frameId: surface.frameId ?? previous?.frameId,
          imageUrl: surface.imageUrl ?? previous?.imageUrl,
          decodedFrame: surface.decodedFrame ?? previous?.decodedFrame,
          sourceReady: surface.sourceReady,
        };
        // Runs on every rendered frame: an unchanged surface must not notify subscribers.
        if (
          previous &&
          next.frameId === previous.frameId &&
          next.imageUrl === previous.imageUrl &&
          next.decodedFrame === previous.decodedFrame &&
          next.sourceReady === previous.sourceReady &&
          (!focused || current.sourceReady === next.sourceReady)
        ) {
          return current;
        }
        return {
          surfaces: { ...current.surfaces, [panelId]: next },
          ...(focused ? { sourceReady: next.sourceReady } : {}),
        };
      });
    };
    const data = getPipeline().playerState.activeData;
    // Observe seek generations before recording a newly decoded identity. A decode event can
    // arrive before React's clock layout effect; that fresh identity must not be blocked later.
    if (previousSeek.current !== data?.lastSeekTime) {
      blockedImage.current = lastSyncedImage.current;
      previousSeek.current = data?.lastSeekTime;
    }
    // Playing never makes the source editable, so no frame is encoded then; the last paused
    // frame's pixels stay published until playback stops and this runs again.
    const previousUrl = session.surfaces[panelId]?.imageUrl;
    const captured = data?.isPlaying === true ? undefined : capture();
    const image = data?.isPlaying === true ? captureMetadata() : captured;
    if (!image || !data || image.topic !== topic) {
      publish({ sourceReady: false });
      return;
    }
    const state = binding.runtime.store.getState();
    let frame = state.document?.frames.find(
      (item) => item.id === `${binding.videoId}:${imageFrameIdentity(image)}`,
    );
    // Message timestamps, not the player clock, identify image frames.
    const messages = data.messages.filter(
      (message) =>
        message.topic === image.topic &&
        toNanoSec(message.receiveTime) <= toNanoSec(data.currentTime),
    );
    const latest = messages[messages.length - 1];
    const matchesClock =
      toNanoSec(image.receiveTime) <= toNanoSec(data.currentTime) &&
      (!latest || toNanoSec(latest.receiveTime) === toNanoSec(image.receiveTime));
    // Zoom and pan render the same decoded image again. Rebuild the source table only when the
    // image or a frame source (player cache, tick messages, the panel's decoder cache) changed.
    const blocks = getPipeline().playerState.progress.messageCache?.blocks;
    const canvasFrames = bridge.sources()?.cachedFrames() ?? [];
    const sources = {
      image: image.decodedIdentity,
      bindingKey: binding.key,
      runtime: binding.runtime,
      blocks,
      blockMessages:
        blocks?.reduce((count, block) => count + (block?.messagesByTopic[topic]?.length ?? 0), 0) ??
        0,
      messages: data.messages,
      canvasFrames: canvasFrames.length,
    };
    const previousSources = registeredImage.current;
    const registered =
      frame != undefined &&
      previousSources != undefined &&
      (Object.keys(sources) as (keyof typeof sources)[]).every(
        (key) => previousSources[key] === sources[key],
      );
    if (matchesClock && state.document && !registered) {
      const video = state.document.videos.find((item) => item.id === binding.videoId);
      if (video) {
        const stamps = receivedFrameStamps(
          [
            ...(blocks?.flatMap((block) => block?.messagesByTopic[topic] ?? []) ?? []),
            ...data.messages,
            ...canvasFrames,
          ],
          topic,
        );
        stamps.set(imageFrameIdentity(image), image);
        const durationSec = Number(toNanoSec(data.endTime) - toNanoSec(data.startTime)) / 1e9;
        binding.runtime.registerSource({
          // A camera that had not decoded a frame at entry learns its source size here.
          videos: [
            image.imageWidth != undefined && image.imageHeight != undefined
              ? { ...video, durationSec, width: image.imageWidth, height: image.imageHeight }
              : { ...video, durationSec },
          ],
          frames: framesFromStamps(binding.videoId, toNanoSec(data.startTime), stamps.values()),
        });
        frame = binding.runtime.store
          .getState()
          .document?.frames.find(
            (item) => item.id === `${binding.videoId}:${imageFrameIdentity(image)}`,
          );
        registeredImage.current = frame ? sources : undefined;
      }
    }
    if (focused && binding.frames) {
      // Keep the windows around the clock listed, so stepping across a window edge has a target.
      const clockNs = toNanoSec(data.currentTime);
      void binding.frames
        .ensureRange(clockNs - SOURCE_FRAME_WINDOW_NS, clockNs + SOURCE_FRAME_WINDOW_NS)
        .catch(() => {
          // A failed window is retried on the next clock change; frames seen on screen still register.
        });
    }
    if (!frame || !matchesClock) {
      // Uncertain identity never leaves a writable overlay on the advancing native image.
      publish({ sourceReady: false });
      if (!frame) {
        setError({ key: "frameSourceMissing" });
      }
      return;
    }
    const durationSec =
      state.document?.videos.find((item) => item.id === frame.videoId)?.durationSec ??
      frame.timestampSec;
    const windowStart = segmentationWindow(frame.timestampSec, durationSec).startSec;
    const nextWindowStart = windowStart + SEGMENTATION_WINDOW_SEC;
    const prefetch = (offsetSec: number) => {
      if (offsetSec < durationSec) {
        const { startSec, endSec } = segmentationWindow(offsetSec, durationSec);
        void state.prefetchFrameWindow(frame.videoId, startSec, endSec);
      }
    };
    // Playing stays on the live decoder. Loading a window here aborts the picture on every frame.
    if (!data.isPlaying && !propagationLocksContext(state.propagation.status)) {
      const needsWindow =
        !state.isFrameReady(frame.id) && !state.loading && !state.frameWindowError;
      if (focused && (state.currentFrameId !== frame.id || needsWindow)) {
        state.setCurrentFrame(frame.id);
      } else if (!focused && !state.isFrameReady(frame.id) && !state.frameWindowError) {
        // In the background: one shared foreground load would abort the focused camera's.
        prefetch(windowStart);
      }
    } else if (data.isPlaying && !propagationLocksContext(state.propagation.status)) {
      // Masks show during playback too: read windows in the background, never touching the picture.
      if (!state.isFrameReady(frame.id)) {
        prefetch(windowStart);
      }
      if (frame.timestampSec >= nextWindowStart - 3) {
        // List the next window's frames first, so its read covers every one of them.
        const nextNs = toNanoSec(data.startTime) + BigInt(Math.round(nextWindowStart * 1e9));
        void (
          binding.frames?.ensureRange(nextNs, nextNs + SOURCE_FRAME_WINDOW_NS - 1n) ??
          Promise.resolve()
        )
          .then(() => {
            prefetch(nextWindowStart);
          })
          .catch(() => {
            prefetch(nextWindowStart);
          });
      }
    }
    const currentMatches = binding.runtime.store.getState().currentFrameId === frame.id;
    lastSyncedImage.current = image.decodedIdentity;
    const previous = session.surfaces[panelId]?.decodedFrame;
    const imageUrl = captured?.encodeImageUrl() ?? previousUrl ?? "";
    const decodedFrame =
      previous?.decodedIdentity === image.decodedIdentity &&
      previous.imageUrl === imageUrl &&
      previous.nativeView === image.nativeView &&
      previous.frameId === frame.id &&
      previous.seekTime === data.lastSeekTime &&
      previous.bindingKey === binding.key &&
      previous.bindingGeneration === generation.current &&
      previous.presentation === session.presentation
        ? previous
        : {
            recordId: binding.runtime.store.getState().document!.record.id,
            videoId: binding.videoId,
            frameId: frame.id,
            panelId,
            bindingKey: binding.key,
            bindingGeneration: generation.current,
            seekTime: data.lastSeekTime,
            decodedIdentity: image.decodedIdentity,
            imageUrl,
            nativeView: image.nativeView,
            viewControls: bridge.sources()?.viewControls,
            presentation: session.presentation,
          };
    publish({
      frameId: frame.id,
      imageUrl: data.isPlaying ? undefined : imageUrl,
      decodedFrame,
      sourceReady: data.isPlaying
        ? false
        : (focused ? currentMatches : true) &&
          binding.runtime.store.getState().isFrameReady(frame.id) &&
          !binding.runtime.store.getState().loading,
    });
  }, [bridge, capture, captureMetadata, getPipeline, host, panelId, topic]);

  useEffect(
    () =>
      host.session.subscribe((next, previous) => {
        if (next.presentation !== previous.presentation) {
          sync();
        }
      }),
    [host, sync],
  );

  useEffect(
    () =>
      sessionRuntime?.store.subscribe((state, previous) => {
        if (
          state.loading !== previous.loading ||
          state.propagation.status !== previous.propagation.status
        ) {
          sync();
        }
      }),
    [sessionRuntime, sync],
  );
  useEffect(() => {
    const onFrame = () => {
      try {
        sync();
      } catch (cause) {
        setError({ text: String(cause) });
        host.session.setState({ sourceReady: false });
      }
    };
    return bridge.subscribeFrames(onFrame);
  }, [bridge, host, sync]);
  // `isPlaying` too: a fixed step plays until its target and then only stops, without moving
  // the clock again. The readiness computed while playing must be recomputed then.
  useLayoutEffect(() => {
    sync();
  }, [sessionClock, lastSeekTime, isPlaying, rawCapture, sync]);

  const enter = useCallback(
    async (mode: "inline" | "maximize") => {
      setError(undefined);
      const bound = active.current;
      const live = host.session.getState();
      if (bound && live.open && live.runtime === bound.runtime && bound.key === latestKey.current) {
        const storeState = bound.runtime.store.getState();
        if (storeState.drawing != undefined && live.panelId !== panelId) {
          bound.runtime.store.setState({
            error: t("finishDrawingBeforeSwitch"),
          });
          return;
        }
        if (live.panelId !== panelId) {
          host.session.setState({ panelId });
          sync();
        }
        if (mode === "maximize") {
          onMaximize();
        }
        return;
      }
      if (!annotatable) {
        setError({ key: "cloudRecordsOnly" });
        return;
      }
      const pipeline = getPipeline();
      const data = pipeline.playerState.activeData;
      const image = captureMetadata();
      if (!data || topic == undefined || (image != undefined && image.topic !== topic)) {
        setError({ key: "waitForDecode" });
        return;
      }
      const imageTopic = image?.topic ?? topic;
      const epoch = ++generation.current;
      const keyAtStart = latestKey.current;
      const stableRecordId = segmentationSourceKey({
        dataAssetName,
        filename: pipeline.playerState.name,
        urlState: pipeline.playerState.urlState,
        playerId: pipeline.playerState.playerId,
      });
      const videoId = JSON.stringify([stableRecordId, mediaIdentity, topic])!;
      const sessionKey = JSON.stringify([userKey, stableRecordId, backendKey])!;
      let runtime: SegmentationRuntime;
      {
        const startNs = toNanoSec(data.startTime);
        const durationSec = Number(toNanoSec(data.endTime) - startNs) / 1e9;
        const stamps = new Map<
          string,
          {
            timestamp: SegmentationImageMetadata["timestamp"];
            receiveTime: SegmentationImageMetadata["receiveTime"];
          }
        >();
        // Cache metadata is bounded by the player's cache; no frame/pixel synthesis or media copies.
        for (const [id, stamp] of receivedFrameStamps(
          [
            ...(pipeline.playerState.progress.messageCache?.blocks.flatMap(
              (block) => block?.messagesByTopic[imageTopic] ?? [],
            ) ?? []),
            ...data.messages,
            ...(bridge.sources()?.cachedFrames() ?? []),
          ],
          imageTopic,
        )) {
          stamps.set(id, stamp);
        }
        if (image) {
          stamps.set(imageFrameIdentity(image), image);
        }
        const document = sourceDocument({
          recordId: stableRecordId,
          recordName: pipeline.playerState.name ?? t("currentMedia"),
          videoId,
          topic: imageTopic,
          image,
          durationSec,
          sizeBytes: 0,
          frames: framesFromStamps(videoId, startNs, stamps.values()),
        });
        const acquired = host.registry.acquire(sessionKey, panelId, () =>
          createSourceRuntime(document, startNs),
        );
        runtime = acquired.runtime;
        if (!acquired.created) {
          await runtime.initialize();
          if (epoch !== generation.current || keyAtStart !== latestKey.current) {
            return;
          }
          runtime.registerSource(document);
        }
      }
      await runtime.initialize();
      if (epoch !== generation.current || keyAtStart !== latestKey.current) {
        return;
      }
      if (propagationLocksContext(runtime.store.getState().propagation.status)) {
        setError({ key: "waitForStop" });
        return;
      }
      const subscribeMessageRange = getPipeline().subscribeMessageRange;
      const boundRuntime = runtime;
      const frames =
        subscribeMessageRange != undefined
          ? createSourceFrameLoader({
              subscribeMessageRange,
              topic: imageTopic,
              videoId,
              startNs: toNanoSec(data.startTime),
              endNs: toNanoSec(data.endTime),
              register: (source) => {
                if (active.current?.runtime === boundRuntime) {
                  boundRuntime.registerSource({ videos: [], frames: source });
                }
              },
              knownLogTimes: () =>
                (boundRuntime.store.getState().document?.frames ?? [])
                  .filter((item) => item.videoId === videoId)
                  .map((item) => BigInt(item.logTimeNs)),
            })
          : undefined;
      active.current?.unbindFrames?.();
      active.current?.frames?.dispose();
      active.current = {
        runtime,
        key: keyAtStart,
        videoId,
        frames,
        unbindFrames: frames && host.sourceFrames.register(frames),
      };
      activateSegmentationRuntime(host.session, runtime);
      const joining = host.session.getState().open && host.session.getState().runtime === runtime;
      host.session.setState({
        open: true,
        panelId: joining ? (host.session.getState().panelId ?? panelId) : panelId,
        ...(joining ? {} : { sourceReady: false }),
      });
      sync();
      if (!joining) {
        runtime.store.getState().setEditing(true);
      }
      sidebarActions.left.selectItem("space");
      if (mode === "maximize") {
        onMaximize();
      }
      if (!joining) {
        for (const canvas of host.chrome.getState().canvases) {
          if (canvas.panelId !== panelId) {
            canvas.enterInline();
          }
        }
      }
      // Entered where this camera shows no frame (e.g. the recording start, before any camera
      // frame): every canvas is blank and nothing can be edited. Move to this camera's first frame.
      if (!joining && image == undefined && frames) {
        const clockNs = toNanoSec(data.currentTime);
        await frames.ensureFollowing(clockNs - 1n, 1).catch(() => undefined);
        const first = cameraStepTarget(
          (runtime.store.getState().document?.frames ?? []).filter(
            (item) => item.videoId === videoId,
          ),
          clockNs - 1n,
          1,
          1,
        );
        const live = getPipeline().playerState.activeData;
        const session = host.session.getState();
        // Skip if the user moved the clock meanwhile or left this session.
        if (
          first != undefined &&
          live != undefined &&
          toNanoSec(live.currentTime) === clockNs &&
          session.open &&
          session.runtime === runtime
        ) {
          getPipeline().seekPlayback?.(fromNanoSec(first));
        }
      }
    },
    [
      host,
      t,
      bridge,
      annotatable,
      captureMetadata,
      dataAssetName,
      getPipeline,
      mediaIdentity,
      onMaximize,
      panelId,
      sidebarActions.left,
      sync,
      topic,
      userKey,
      createSourceRuntime,
      backendKey,
    ],
  );

  const enterRef = useRef(enter);
  useLayoutEffect(() => {
    enterRef.current = enter;
  });
  useLayoutEffect(() => {
    const start = (mode: "inline" | "maximize") => {
      const go = () => {
        void enterRef.current(mode).catch((cause: unknown) => {
          setError({ text: String(cause) });
        });
      };
      if (host.session.getState().open || !needsSegmentationProfileCheck(playerUrlState)) {
        go();
        return;
      }
      // Annotation is fixed to one transcode quality; on another one the page switches to it
      // (and the user starts again once it is back).
      void ensureSegmentationProfile(playerUrlState).then((result) => {
        if (result === "ready") {
          go();
        }
      });
    };
    onActionsChange({
      enterInline: () => {
        start("inline");
      },
      enterMaximize: () => {
        start("maximize");
      },
    });
    return () => {
      onActionsChange(undefined);
    };
  }, [enter, host, onActionsChange, playerUrlState]);

  useLayoutEffect(() => {
    onAvailabilityChange?.(sessionRuntime == undefined ? "available" : "hidden");
  }, [onAvailabilityChange, sessionRuntime]);

  if (sessionRuntime) {
    return undefined;
  }
  const preview = <SegmentationPreview containerRef={containerRef} topic={topic} bridge={bridge} />;
  return (
    <>
      {error ? (
        <div className={classes.error} role="alert">
          {"key" in error ? t(error.key) : error.text}
        </div>
      ) : undefined}
      {preview}
    </>
  );
}
