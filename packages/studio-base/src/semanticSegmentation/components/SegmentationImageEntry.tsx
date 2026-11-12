// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useStore } from "zustand";

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { createLiveSemanticSegmentationService } from "@foxglove/studio-base/util/coscene/annotation";

import { previewWindowNeedsLoad, previewWindowStartSec } from "../annotationFrames";
import {
  imageFrameIdentity,
  presentationFrameAt,
  segmentationCachedFrames,
  segmentationImageSources,
  segmentationSourceKey,
  type SegmentationImage,
} from "../imageSource";
import {
  activateSegmentationRuntime,
  createSegmentationRuntime,
  segmentationSession,
  type SegmentationRuntime,
  type SegmentationSurface,
} from "../runtime";
import { segmentationChrome } from "../segmentationChrome";
import type { SemanticSegmentationService } from "../service";
import {
  SOURCE_FRAME_WINDOW_NS,
  createSourceFrameLoader,
  sourceFrameLoaders,
  type SourceFrameLoader,
} from "../sourceFrames";
import type { SegmentationDocument } from "../types";
import { AnnotationPreview } from "./AnnotationPreview";

import "./workbench.css";

export type SegmentationImageEntryActions = {
  enterInline: () => void;
  enterMaximize: () => void;
};

const sessions = new Map<string, SegmentationRuntime>();
type Binding = {
  runtime: SegmentationRuntime;
  key: string;
  videoId: string;
  providerId?: string;
  sourceId?: string;
  /** Lists this camera's frames from the data source. Absent for remote video files. */
  frames?: SourceFrameLoader;
};

function cachedCanvasFrames(
  container: HTMLElement | ReactNull,
): ReturnType<NonNullable<ReturnType<typeof segmentationCachedFrames.get>>> {
  const canvas = container?.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return [];
  }
  return segmentationCachedFrames.get(canvas)?.() ?? [];
}

function receivedFrameStamps(
  messages: readonly {
    topic: string;
    message: unknown;
    receiveTime: SegmentationImage["receiveTime"];
  }[],
  topic: string,
): Map<
  string,
  { timestamp: SegmentationImage["timestamp"]; receiveTime: SegmentationImage["receiveTime"] }
> {
  const stamps = new Map<
    string,
    { timestamp: SegmentationImage["timestamp"]; receiveTime: SegmentationImage["receiveTime"] }
  >();
  for (const message of messages) {
    if (message.topic !== topic) {
      continue;
    }
    const value = message.message as {
      timestamp?: SegmentationImage["timestamp"];
      header?: { stamp: SegmentationImage["timestamp"] };
    };
    const stamp = {
      timestamp: value.header?.stamp ?? value.timestamp ?? message.receiveTime,
      receiveTime: message.receiveTime,
    };
    stamps.set(imageFrameIdentity(stamp), stamp);
  }
  return stamps;
}

function sourceFrames(
  videoId: string,
  startTime: SegmentationImage["receiveTime"],
  stamps: Iterable<Pick<SegmentationImage, "timestamp" | "receiveTime">>,
) {
  const startNs = toNanoSec(startTime);
  return [...stamps].map((stamp) => ({
    id: `${videoId}:${imageFrameIdentity(stamp)}`,
    videoId,
    index: 0,
    timestampSec: Number(toNanoSec(stamp.receiveTime) - startNs) / 1e9,
    logTimeNs: toNanoSec(stamp.receiveTime).toString(),
    imageUrl: "",
  }));
}

function propagationLocksContext(status: string): boolean {
  return status === "running" || status === "stopping";
}

export function SegmentationImageEntry({
  containerRef,
  topic,
  panelId,
  onMaximize,
  onActionsChange,
  onAvailabilityChange,
  service: injectedService,
}: {
  containerRef: RefObject<HTMLDivElement>;
  topic?: string;
  panelId: string;
  onMaximize: () => void;
  /** When set, entry actions are hosted by the panel toolbar instead of a floating overlay. */
  onActionsChange?: (actions: SegmentationImageEntryActions | undefined) => void;
  onAvailabilityChange?: (state: "available" | "hidden") => void;
  /**
   * Published annotation client. Until that client exists, omit this. The panel then
   * keeps annotations for the open recording in the browser. That store is not the live API.
   */
  service?: SemanticSegmentationService;
}): React.JSX.Element | undefined {
  const { sidebarActions } = useWorkspaceActions();
  const getPipeline = useMessagePipelineGetter();
  const player = useMessagePipeline((state) => state.playerState);
  const cachedBlocks = useMessagePipeline(
    (state) => state.playerState.progress.messageCache?.blocks.length ?? 0,
  );
  const record = useCoreData((store) => store.record.value);
  const userId = useCurrentUser((store) => store.user?.userId);
  const annotationService = injectedService ?? createLiveSemanticSegmentationService();
  // The open record is Core Data. A second file in that record is a different playback URL,
  // not a second name on the record, so the title must not hide the URL.
  const file = record
    ? {
        dataAssetName: record.name,
        filename: undefined as string | undefined,
        name: undefined as string | undefined,
        sizeBytes: undefined as bigint | undefined,
      }
    : undefined;
  const userKey = userId ?? "demo";
  const active = useRef<Binding>();
  const sessionOpen = useStore(segmentationSession, (session) => session.open);
  const sessionRuntime = useStore(segmentationSession, (session) =>
    session.open ? session.runtime : undefined,
  );
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const pending = useRef<{ runtime: SegmentationRuntime; epoch: number }>();
  const blockedImage = useRef<object>();
  const lastSyncedImage = useRef<object>();
  const [error, setError] = useState<string>();
  const toolbarHosted = onActionsChange != undefined;
  const recordId = segmentationSourceKey({
    dataAssetName: file?.dataAssetName,
    filename: file?.filename ?? player.name,
    sizeBytes: file?.sizeBytes?.toString(),
    urlState: player.urlState,
    playerId: player.playerId,
  });
  const mediaIdentity =
    file?.name ?? file?.filename ?? player.urlState?.parameters?.url ?? player.name;
  const bindingKey = JSON.stringify([userKey, player.playerId, recordId, mediaIdentity, topic])!;
  const previousKey = useRef(bindingKey);
  const previousSeek = useRef(player.activeData?.lastSeekTime);
  const latestKey = useRef(bindingKey);
  latestKey.current = bindingKey;
  const rawCapture = useCallback(() => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return undefined;
    }
    return segmentationImageSources.get(canvas)?.();
  }, [containerRef]);
  const capture = useCallback(() => {
    const image = rawCapture();
    return image?.decodedIdentity === blockedImage.current ? undefined : image;
  }, [rawCapture]);

  const previewCanStart = cachedBlocks > 0 || capture() != undefined;
  const previewWindowStart = previewWindowStartSec(
    player.activeData
      ? Number(toNanoSec(player.activeData.currentTime) - toNanoSec(player.activeData.startTime)) /
          1e9
      : Number.NaN,
  );
  useEffect(() => {
    if (topic == undefined || sessionOpen || previewWindowStart == undefined) {
      return;
    }
    const pipeline = getPipeline();
    const data = pipeline.playerState.activeData;
    const image = capture();
    if (!data) {
      return;
    }
    const cached = [
      ...(pipeline.playerState.progress.messageCache?.blocks.flatMap(
        (block) => block?.messagesByTopic[topic] ?? [],
      ) ?? []),
      ...data.messages.filter((message) => message.topic === topic),
    ];
    if (!image && cached.length === 0) {
      return;
    }
    const epoch = ++previewGeneration.current;
    const gate = { stop: false };
    const superseded = () =>
      gate.stop || epoch !== previewGeneration.current || segmentationSession.getState().open;
    segmentationSession.setState({ previewLoading: true });
    void (async () => {
      try {
        const stableRecordId = segmentationSourceKey({
          dataAssetName: file?.dataAssetName,
          filename: file?.filename ?? pipeline.playerState.name,
          sizeBytes: file?.sizeBytes?.toString(),
          urlState: pipeline.playerState.urlState,
          sourceUrl: image?.source?.sourceId,
          playerId: pipeline.playerState.playerId,
        });
        const videoId = JSON.stringify([stableRecordId, mediaIdentity, topic])!;
        const sessionKey = JSON.stringify([userKey, stableRecordId])!;
        const startNs = toNanoSec(data.startTime);
        const durationSec = Number(toNanoSec(data.endTime) - startNs) / 1e9;
        const stamps = new Map<string, SegmentationImage>();
        for (const message of cached) {
          const value = message.message as {
            timestamp?: SegmentationImage["timestamp"];
            header?: { stamp: SegmentationImage["timestamp"] };
          };
          const timestamp = value.header?.stamp ?? value.timestamp ?? message.receiveTime;
          const stamp: SegmentationImage = {
            topic,
            timestamp,
            receiveTime: message.receiveTime,
            imageUrl: "",
            decodedIdentity: message,
          };
          stamps.set(imageFrameIdentity(stamp), stamp);
        }
        if (image) {
          stamps.set(imageFrameIdentity(image), image);
        }
        const bitmap = containerRef.current?.querySelector("canvas");
        const document: SegmentationDocument = {
          record: {
            id: stableRecordId,
            name: file?.filename ?? pipeline.playerState.name ?? "当前媒体",
          },
          videos: [
            {
              id: videoId,
              recordId: stableRecordId,
              name: topic,
              topic,
              width:
                bitmap instanceof HTMLCanvasElement && bitmap.width > 0 ? bitmap.width : undefined,
              height:
                bitmap instanceof HTMLCanvasElement && bitmap.height > 0
                  ? bitmap.height
                  : undefined,
              durationSec,
              fps: 0,
              sizeBytes: Number(file?.sizeBytes ?? 0n),
              mediaUrl: image?.source?.sourceId ?? "",
            },
          ],
          frames: [...stamps.entries()]
            .sort(([, left], [, right]) =>
              Number(toNanoSec(left.receiveTime) - toNanoSec(right.receiveTime)),
            )
            .map(([id, stamp], index) => ({
              id: `${videoId}:${id}`,
              videoId,
              index,
              timestampSec: Number(toNanoSec(stamp.receiveTime) - startNs) / 1e9,
              logTimeNs: toNanoSec(stamp.receiveTime).toString(),
              imageUrl: "",
            })),
          classes: [],
          instances: [],
          annotations: {},
          annotationSummaries: {},
          versions: {},
          momentReferences: [],
        };
        let runtime = sessions.get(sessionKey);
        if (!runtime) {
          runtime = createSegmentationRuntime(
            document,
            { storageKey: `coStudio.semanticSegmentation.source.v2:${sessionKey}` },
            {
              ...(userId
                ? {
                    identity: {
                      userId,
                      sessionId: JSON.stringify([userKey, stableRecordId, panelId])!,
                    },
                  }
                : {}),
              ...(annotationService ? { service: annotationService } : {}),
            },
          );
          sessions.set(sessionKey, runtime);
        } else {
          runtime.registerSource(document);
        }
        await runtime.initialize();
        if (superseded()) {
          if (!gate.stop && epoch === previewGeneration.current) {
            segmentationSession.setState({ previewLoading: false });
          }
          return;
        }
        const state = runtime.store.getState();
        const frames = state.document?.frames.filter((item) => item.videoId === videoId) ?? [];
        if (
          !state.loading &&
          previewWindowNeedsLoad(
            frames,
            (frame) => state.isFrameReady(frame.id),
            previewWindowStart,
            durationSec,
          )
        ) {
          await state.loadFrameWindow(
            videoId,
            previewWindowStart,
            Math.min(previewWindowStart + 10, durationSec),
          );
        }
        if (superseded()) {
          if (!gate.stop && epoch === previewGeneration.current) {
            segmentationSession.setState({ previewLoading: false });
          }
          return;
        }
        segmentationSession.setState({ previewRuntime: runtime, previewLoading: false });
      } catch {
        if (!gate.stop && epoch === previewGeneration.current) {
          segmentationSession.setState({ previewLoading: false });
        }
      }
    })();
    return () => {
      gate.stop = true;
      segmentationSession.setState({ previewLoading: false });
    };
  }, [
    previewCanStart,
    capture,
    containerRef,
    file?.dataAssetName,
    file?.filename,
    file?.sizeBytes,
    getPipeline,
    mediaIdentity,
    panelId,
    previewWindowStart,
    sessionOpen,
    topic,
    userId,
    userKey,
    annotationService,
  ]);

  const close = useCallback(() => {
    ++generation.current;
    const binding = active.current;
    active.current = undefined;
    pending.current = undefined;
    if (binding?.frames) {
      binding.frames.dispose();
      if (sourceFrameLoaders.get(binding.videoId) === binding.frames) {
        sourceFrameLoaders.delete(binding.videoId);
      }
    }
    const ownsSession =
      binding != undefined &&
      segmentationSession.getState().runtime === binding.runtime &&
      segmentationSession.getState().panelId === panelId;
    const remaining = { ...segmentationSession.getState().surfaces };
    delete remaining[panelId];
    const nextPanelId = Object.keys(remaining)[0];
    const handoff = ownsSession && nextPanelId != undefined;
    if (binding != undefined && ownsSession && !handoff) {
      if (propagationLocksContext(binding.runtime.store.getState().propagation.status)) {
        binding.runtime.store.getState().stopPropagation();
      }
      binding.runtime.store.setState({ editing: false, drawingPolygonId: undefined });
    } else if (
      binding != undefined &&
      handoff &&
      binding.runtime.store.getState().drawingPolygonId != undefined
    ) {
      binding.runtime.store.setState({ drawingPolygonId: undefined });
    }
    if (!ownsSession && segmentationSession.getState().surfaces[panelId] == undefined) {
      return;
    }
    segmentationSession.setState((session) => {
      const surfaces = { ...session.surfaces };
      delete surfaces[panelId];
      const successor = Object.keys(surfaces)[0];
      if (!ownsSession || successor == undefined) {
        return ownsSession
          ? {
              open: false,
              imageUrl: undefined,
              decodedFrame: undefined,
              panelId: undefined,
              sourceReady: false,
              surfaces: {},
            }
          : { surfaces };
      }
      const next = surfaces[successor]!;
      return {
        surfaces,
        panelId: successor,
        imageUrl: next.imageUrl,
        decodedFrame: next.decodedFrame,
        sourceReady: next.sourceReady,
      };
    });
  }, [panelId]);

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
    const session = segmentationSession.getState();
    if (!binding) {
      return;
    }
    if (binding.key !== latestKey.current || !session.open || session.runtime !== binding.runtime) {
      return;
    }
    const focused = session.panelId === panelId;
    const publish = (surface: SegmentationSurface) => {
      segmentationSession.setState((current) => {
        const previous = current.surfaces[panelId];
        const next: SegmentationSurface = {
          frameId: surface.frameId ?? previous?.frameId,
          imageUrl: surface.imageUrl ?? previous?.imageUrl,
          decodedFrame: surface.decodedFrame ?? previous?.decodedFrame,
          sourceReady: surface.sourceReady,
        };
        return {
          surfaces: { ...current.surfaces, [panelId]: next },
          ...(focused
            ? {
                imageUrl: next.imageUrl,
                decodedFrame: next.decodedFrame,
                sourceReady: next.sourceReady,
              }
            : {}),
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
    const image = capture();
    if (
      image &&
      (image.providerId !== binding.providerId || image.source?.sourceId !== binding.sourceId)
    ) {
      close();
      return;
    }
    if (!image || !data || image.topic !== topic) {
      publish({ sourceReady: false });
      return;
    }
    const state = binding.runtime.store.getState();
    let frame = state.document?.frames.find(
      (item) => item.id === `${binding.videoId}:${imageFrameIdentity(image)}`,
    );
    let matchesClock = false;
    if (image.source) {
      const expected =
        image.source.frames[presentationFrameAt(image.source.frames, toNanoSec(data.currentTime))];
      matchesClock = expected?.timestampNs === toNanoSec(image.receiveTime);
    } else {
      // Message timestamps, not the player clock, identify raw/compressed image frames.
      const messages = data.messages.filter(
        (message) =>
          message.topic === image.topic &&
          toNanoSec(message.receiveTime) <= toNanoSec(data.currentTime),
      );
      const latest = messages[messages.length - 1];
      matchesClock =
        toNanoSec(image.receiveTime) <= toNanoSec(data.currentTime) &&
        (!latest || toNanoSec(latest.receiveTime) === toNanoSec(image.receiveTime));
    }
    if (matchesClock && !image.source && state.document) {
      const video = state.document.videos.find((item) => item.id === binding.videoId);
      if (video) {
        const pipeline = getPipeline();
        const stamps = receivedFrameStamps(
          [
            ...(pipeline.playerState.progress.messageCache?.blocks.flatMap(
              (block) => block?.messagesByTopic[topic] ?? [],
            ) ?? []),
            ...data.messages,
            ...cachedCanvasFrames(containerRef.current),
          ],
          topic,
        );
        stamps.set(imageFrameIdentity(image), image);
        const durationSec = Number(toNanoSec(data.endTime) - toNanoSec(data.startTime)) / 1e9;
        binding.runtime.registerSource({
          videos: [{ ...video, durationSec }],
          frames: sourceFrames(binding.videoId, data.startTime, stamps.values()),
        });
        frame = binding.runtime.store
          .getState()
          .document?.frames.find(
            (item) => item.id === `${binding.videoId}:${imageFrameIdentity(image)}`,
          );
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
        setError("当前帧尚无来源元数据，请关闭后重新进入以载入已接收的真实帧。");
      }
      return;
    }
    // Playing stays on the live decoder. Loading a window here aborts the picture on every frame.
    if (!data.isPlaying && !propagationLocksContext(state.propagation.status)) {
      const needsWindow =
        !state.isFrameReady(frame.id) && !state.loading && !state.frameWindowError;
      if (focused && (state.currentFrameId !== frame.id || needsWindow)) {
        state.setCurrentFrame(frame.id);
      } else if (!focused && needsWindow) {
        const duration =
          state.document?.videos.find((item) => item.id === frame.videoId)?.durationSec ??
          frame.timestampSec;
        const start = Math.floor(frame.timestampSec / 10) * 10;
        void state.loadFrameWindow(frame.videoId, start, Math.min(start + 10, duration));
      }
    }
    const currentMatches = binding.runtime.store.getState().currentFrameId === frame.id;
    lastSyncedImage.current = image.decodedIdentity;
    const previous = session.surfaces[panelId]?.decodedFrame ?? session.decodedFrame;
    const decodedFrame =
      previous?.decodedIdentity === image.decodedIdentity &&
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
            imageUrl: image.imageUrl,
            nativeView: image.nativeView,
            nativeCanvas: containerRef.current?.querySelector("canvas") ?? undefined,
            presentation: session.presentation,
          };
    publish({
      frameId: frame.id,
      imageUrl: image.imageUrl,
      decodedFrame,
      sourceReady: data.isPlaying
        ? false
        : (focused ? currentMatches : true) &&
          binding.runtime.store.getState().isFrameReady(frame.id) &&
          !binding.runtime.store.getState().loading,
    });
  }, [capture, close, containerRef, getPipeline, panelId, topic]);

  useEffect(
    () =>
      segmentationSession.subscribe((next, previous) => {
        if (next.presentation !== previous.presentation) {
          sync();
        }
      }),
    [sync],
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
    const container = containerRef.current;
    const onFrame = () => {
      try {
        sync();
      } catch (cause) {
        setError(String(cause));
        segmentationSession.setState({ sourceReady: false });
      }
    };
    container?.addEventListener("segmentation-frame", onFrame);
    return () => {
      container?.removeEventListener("segmentation-frame", onFrame);
    };
  }, [containerRef, sync]);
  useLayoutEffect(() => {
    sync();
  }, [player.activeData?.currentTime, player.activeData?.lastSeekTime, rawCapture, sync]);

  const enter = useCallback(
    async (mode: "inline" | "maximize") => {
      setError(undefined);
      const bound = active.current;
      const live = segmentationSession.getState();
      if (bound && live.open && live.runtime === bound.runtime && bound.key === latestKey.current) {
        const storeState = bound.runtime.store.getState();
        if (storeState.drawingPolygonId != undefined && live.panelId !== panelId) {
          bound.runtime.store.setState({
            error: "先完成当前画布上的多边形，再标注另一路。",
          });
          return;
        }
        if (live.panelId !== panelId) {
          segmentationSession.setState({ panelId });
          sync();
        }
        if (mode === "maximize") {
          onMaximize();
        }
        return;
      }
      const pipeline = getPipeline();
      const data = pipeline.playerState.activeData;
      const image = capture();
      if (!data || topic == undefined || (image != undefined && image.topic !== topic)) {
        setError("请等待当前来源的图像解码完成。");
        return;
      }
      const imageTopic = image?.topic ?? topic;
      const epoch = ++generation.current;
      const keyAtStart = latestKey.current;
      const stableRecordId = segmentationSourceKey({
        dataAssetName: file?.dataAssetName,
        filename: file?.filename ?? pipeline.playerState.name,
        sizeBytes: file?.sizeBytes?.toString(),
        urlState: pipeline.playerState.urlState,
        sourceUrl: image?.source?.sourceId,
        playerId: pipeline.playerState.playerId,
      });
      const videoId = JSON.stringify([stableRecordId, mediaIdentity, topic])!;
      const sessionKey = JSON.stringify([userKey, stableRecordId])!;
      let runtime = sessions.get(sessionKey);
      {
        const startNs = toNanoSec(data.startTime);
        const durationSec = Number(toNanoSec(data.endTime) - startNs) / 1e9;
        const stamps = new Map<
          string,
          {
            timestamp: SegmentationImage["timestamp"];
            receiveTime: SegmentationImage["receiveTime"];
          }
        >();
        if (image?.source) {
          for (const frame of image.source.frames) {
            const time = fromNanoSec(frame.timestampNs);
            stamps.set(`${frame.timestampNs}:${frame.timestampNs}`, {
              timestamp: time,
              receiveTime: time,
            });
          }
        } else {
          // Cache metadata is bounded by the player's cache; no frame/pixel synthesis or media copies.
          for (const [id, stamp] of receivedFrameStamps(
            [
              ...(pipeline.playerState.progress.messageCache?.blocks.flatMap(
                (block) => block?.messagesByTopic[imageTopic] ?? [],
              ) ?? []),
              ...data.messages,
              ...cachedCanvasFrames(containerRef.current),
            ],
            imageTopic,
          )) {
            stamps.set(id, stamp);
          }
          if (image) {
            stamps.set(imageFrameIdentity(image), image);
          }
        }
        const bitmap = containerRef.current?.querySelector("canvas");
        const width =
          bitmap instanceof HTMLCanvasElement && bitmap.width > 0 ? bitmap.width : undefined;
        const height =
          bitmap instanceof HTMLCanvasElement && bitmap.height > 0 ? bitmap.height : undefined;
        const document: SegmentationDocument = {
          record: {
            id: stableRecordId,
            name: file?.filename ?? pipeline.playerState.name ?? "当前媒体",
          },
          videos: [
            {
              id: videoId,
              recordId: stableRecordId,
              name: imageTopic,
              topic: imageTopic,
              width,
              height,
              durationSec,
              fps: 0,
              sizeBytes: Number(file?.sizeBytes ?? 0n),
              mediaUrl: image?.source?.sourceId ?? "",
            },
          ],
          frames: [...stamps.entries()]
            .sort(([, a], [, b]) => Number(toNanoSec(a.receiveTime) - toNanoSec(b.receiveTime)))
            .map(([id, stamp], index) => ({
              id: `${videoId}:${id}`,
              videoId,
              index,
              timestampSec: Number(toNanoSec(stamp.receiveTime) - startNs) / 1e9,
              logTimeNs: toNanoSec(stamp.receiveTime).toString(),
              imageUrl: "",
            })),
          classes: [],
          instances: [],
          annotations: {},
          annotationSummaries: {},
          versions: {},
          momentReferences: [],
        };
        if (!runtime) {
          runtime = createSegmentationRuntime(
            document,
            {
              storageKey: `coStudio.semanticSegmentation.source.v2:${sessionKey}`,
            },
            {
              ...(userId
                ? {
                    identity: {
                      userId,
                      sessionId: JSON.stringify([userKey, stableRecordId, panelId])!,
                    },
                  }
                : {}),
              ...(annotationService ? { service: annotationService } : {}),
            },
          );
          sessions.set(sessionKey, runtime);
        } else {
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
        setError("请等待传播停止确认后再进入标注。");
        return;
      }
      const activation = { runtime, epoch };
      pending.current = activation;
      if (epoch !== generation.current || keyAtStart !== latestKey.current) {
        if (pending.current === activation) {
          pending.current = undefined;
        }
        return;
      }
      pending.current = undefined;
      const subscribeMessageRange = getPipeline().subscribeMessageRange;
      const boundRuntime = runtime;
      const frames =
        image?.source == undefined && subscribeMessageRange != undefined
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
      active.current?.frames?.dispose();
      active.current = {
        runtime,
        key: keyAtStart,
        videoId,
        providerId: image?.providerId,
        sourceId: image?.source?.sourceId,
        frames,
      };
      if (frames) {
        sourceFrameLoaders.set(videoId, frames);
      }
      activateSegmentationRuntime(runtime);
      const joining =
        segmentationSession.getState().open && segmentationSession.getState().runtime === runtime;
      segmentationSession.setState({
        open: true,
        maximized: false,
        panelId: joining ? (segmentationSession.getState().panelId ?? panelId) : panelId,
        ...(joining ? {} : { imageUrl: undefined, decodedFrame: undefined, sourceReady: false }),
      });
      sync();
      if (!joining && !runtime.store.getState().readonly) {
        runtime.store.getState().setEditing(true);
      }
      sidebarActions.left.selectItem("space");
      if (mode === "maximize") {
        onMaximize();
      }
      if (!joining) {
        for (const canvas of segmentationChrome.getState().canvases) {
          if (canvas.panelId !== panelId) {
            canvas.enterInline();
          }
        }
      }
    },
    [
      capture,
      file?.dataAssetName,
      file?.filename,
      file?.sizeBytes,
      getPipeline,
      containerRef,
      mediaIdentity,
      onMaximize,
      panelId,
      sidebarActions.left,
      sync,
      topic,
      userId,
      userKey,
      annotationService,
    ],
  );

  useLayoutEffect(() => {
    if (!onActionsChange) {
      return;
    }
    onActionsChange({
      enterInline: () => {
        void enter("inline").catch((cause: unknown) => {
          setError(String(cause));
        });
      },
      enterMaximize: () => {
        void enter("maximize").catch((cause: unknown) => {
          setError(String(cause));
        });
      },
    });
    return () => {
      onActionsChange(undefined);
    };
  }, [enter, onActionsChange]);

  useLayoutEffect(() => {
    onAvailabilityChange?.(sessionRuntime == undefined ? "available" : "hidden");
  }, [onAvailabilityChange, sessionRuntime]);

  if (sessionRuntime) {
    return undefined;
  }
  const preview = <AnnotationPreview containerRef={containerRef} topic={topic} />;
  if (toolbarHosted) {
    return (
      <>
        {error ? (
          <div className="seg-entry-error" role="alert">
            {error}
          </div>
        ) : undefined}
        {preview}
      </>
    );
  }
  return (
    <>
      <div className="seg-entry">
        <button
          type="button"
          title="编辑空间标注"
          onClick={() => {
            void enter("inline").catch((cause: unknown) => {
              setError(String(cause));
            });
          }}
        >
          ✎ 编辑空间标注
        </button>
        <button
          type="button"
          title="放大并编辑空间标注"
          aria-label="放大并编辑空间标注"
          onClick={() => {
            void enter("maximize").catch((cause: unknown) => {
              setError(String(cause));
            });
          }}
        >
          ⛶
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
      {preview}
    </>
  );
}
