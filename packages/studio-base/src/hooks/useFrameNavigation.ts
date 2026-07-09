// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  type AdjacentMessagePathMatchResult,
  findAdjacentMessagePathMatch,
  type FrameNavigationDirection,
} from "@foxglove/studio-base/components/MessagePathSyntax/findAdjacentMessagePathMatch";
import {
  type MessageAndData,
  useCachedGetMessagePathDataItems,
} from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  useMessagePipeline,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";

import { frameNavigationNotifier } from "./FrameNavigationNotifier";
import {
  type FrameNavigationState,
  useFallbackFrameNavigation,
} from "./useFallbackFrameNavigation";
import { type KeyHandlers, useFrameNavigationKeyboard } from "./useFrameNavigationKeyboard";
import { useRequestWindowDuration } from "./useRequestWindowDuration";

// Selector functions for player controls
const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectStartPlayback = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPausePlayback = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectSubscribeMessageRange = (ctx: MessagePipelineContext) => ctx.subscribeMessageRange;
const selectActiveData = (ctx: MessagePipelineContext) => ctx.playerState.activeData;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

export interface FrameNavigationHook {
  /** Whether there is a previous frame available */
  hasPreFrame: boolean;
  /** Handler for previous frame button */
  handlePreviousFrame: () => void;
  /** Handler for next frame button - pass current messages to enable freezing */
  handleNextFrame: (currentMessages?: MessageAndData[]) => void;
  /** Restore callback to be passed to useMessageDataItem */
  onRestore: () => void;
  /** Get effective messages (considering frozen state for next frame) */
  getEffectiveMessages: <T extends MessageAndData[]>(messages: T) => T;
  /** Update rendered time based on messages - should be called in useEffect */
  updateRenderedTime: (messages: MessageAndData[]) => void;
  /** KeyDown handlers for KeyListener component */
  keyDownHandlers: KeyHandlers;
  /** KeyUp handlers for KeyListener component */
  keyUpHandlers: KeyHandlers;
  /** Ref to attach to panel container for focus detection */
  panelRef: RefObject<HTMLDivElement>;
  isFrameNavigationPending: boolean;
}

type UseFrameNavigationOptions = {
  readonly path?: string;
  readonly noPreviousFrameMessage?: string;
  readonly noNextFrameMessage?: string;
};

/**
 * Hook for frame navigation functionality (Previous/Next Frame)
 * Extracted from RawMessages panel for reuse across panels
 */
export function useFrameNavigation(options: UseFrameNavigationOptions = {}): FrameNavigationHook {
  const {
    path = "",
    noPreviousFrameMessage = "No previous matching frame found",
    noNextFrameMessage = "No next matching frame found",
  } = options;
  // Player control hooks
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const startPlayback = useMessagePipeline(selectStartPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);
  const subscribeMessageRange = useMessagePipeline(selectSubscribeMessageRange);
  const activeData = useMessagePipeline(selectActiveData);
  const playerId = useMessagePipeline(selectPlayerId);
  const getMessagePathDataItems = useCachedGetMessagePathDataItems(path.length > 0 ? [path] : []);
  const { enqueueSnackbar } = useSnackbar();

  const [isFrameNavigationPending, setIsFrameNavigationPending] = useState(false);
  const [rangeNavigationUnsupported, setRangeNavigationUnsupported] = useState(false);
  const requestWindowDuration = useRequestWindowDuration();

  // Unique identifier for this hook instance
  const navigationId = useRef(uuidv4());

  // Flag bit to indicate that the next message is the previous frame, current frame, next frame.
  const frameState = useRef<FrameNavigationState>("current");
  const activeRangeNavigation = useRef<AbortController | undefined>();

  const activeTimes = useMemo(() => {
    return activeData != undefined
      ? { currentTime: activeData.currentTime, startTime: activeData.startTime }
      : undefined;
  }, [activeData]);
  const activeSubscribeMessageRange = rangeNavigationUnsupported
    ? undefined
    : subscribeMessageRange;
  const {
    hasPreFrame,
    currentMessagesRef,
    freezeCurrentMessages,
    clearFrozenMessages,
    resetRenderedHistory,
    restoreFallbackState,
    runFallbackPreviousFrame,
    runFallbackNextFrame,
    getEffectiveMessages,
    updateRenderedTime,
  } = useFallbackFrameNavigation({
    frameState,
    navigationId,
    notifier: frameNavigationNotifier,
    seekPlayback,
    startPlayback,
    pausePlayback,
    activeTimes:
      activeSubscribeMessageRange != undefined && path.length > 0 ? activeTimes : undefined,
  });

  const cancelActiveRangeNavigation = useCallback((): boolean => {
    const hadActiveRangeNavigation = activeRangeNavigation.current != undefined;
    activeRangeNavigation.current?.abort();
    activeRangeNavigation.current = undefined;
    return hadActiveRangeNavigation;
  }, []);

  const finishFrameNavigation = useCallback(() => {
    cancelActiveRangeNavigation();
    frameState.current = "current";
    frameNavigationNotifier.endNavigation(navigationId.current);
    clearFrozenMessages();
    setIsFrameNavigationPending(false);
  }, [cancelActiveRangeNavigation, clearFrozenMessages]);

  const beginRangeFrameNavigation = useCallback(
    (direction: FrameNavigationDirection, controller: AbortController) => {
      activeRangeNavigation.current = controller;
      freezeCurrentMessages();
      pausePlayback?.();
      frameNavigationNotifier.startNavigation(navigationId.current);
      frameState.current = direction;
      setIsFrameNavigationPending(true);
    },
    [freezeCurrentMessages, pausePlayback],
  );

  const onRestore = useCallback(() => {
    const hadActiveRangeNavigation = cancelActiveRangeNavigation();

    if (hadActiveRangeNavigation) {
      frameState.current = "current";
      frameNavigationNotifier.endNavigation(navigationId.current);
      clearFrozenMessages();
      resetRenderedHistory();
      setIsFrameNavigationPending(false);
      return;
    }

    if (restoreFallbackState()) {
      setIsFrameNavigationPending(false);
    }
  }, [
    cancelActiveRangeNavigation,
    clearFrozenMessages,
    resetRenderedHistory,
    restoreFallbackState,
  ]);

  const handleRangeNavigationResult = useCallback(
    (direction: FrameNavigationDirection, result: AdjacentMessagePathMatchResult) => {
      switch (result.type) {
        case "found":
          setRangeNavigationUnsupported(false);
          seekPlayback?.(result.message.messageEvent.receiveTime);
          return;
        case "notFound":
          setRangeNavigationUnsupported(false);
          enqueueSnackbar(direction === "previous" ? noPreviousFrameMessage : noNextFrameMessage, {
            variant: "info",
          });
          finishFrameNavigation();
          return;
        case "unsupported":
          setRangeNavigationUnsupported(true);
          frameState.current = "current";
          clearFrozenMessages();
          setIsFrameNavigationPending(false);
          const fallbackHandled =
            direction === "previous"
              ? runFallbackPreviousFrame()
              : runFallbackNextFrame(currentMessagesRef.current);
          if (!fallbackHandled) {
            resetRenderedHistory();
            frameNavigationNotifier.endNavigation(navigationId.current);
          }
          return;
        case "aborted":
          finishFrameNavigation();
          return;
        case "error":
          enqueueSnackbar(result.error.message, { variant: "error" });
          finishFrameNavigation();
          return;
      }
    },
    [
      currentMessagesRef,
      clearFrozenMessages,
      enqueueSnackbar,
      finishFrameNavigation,
      noNextFrameMessage,
      noPreviousFrameMessage,
      resetRenderedHistory,
      runFallbackNextFrame,
      runFallbackPreviousFrame,
      seekPlayback,
    ],
  );

  const runRangeFrameNavigation = useCallback(
    async (direction: FrameNavigationDirection) => {
      if (frameState.current !== "current") {
        return;
      }
      if (
        activeSubscribeMessageRange == undefined ||
        activeData == undefined ||
        seekPlayback == undefined ||
        path.length === 0
      ) {
        return;
      }

      const latestMessage = currentMessagesRef.current[currentMessagesRef.current.length - 1];
      const fromTime = latestMessage?.messageEvent.receiveTime ?? activeData.currentTime;
      const controller = new AbortController();

      beginRangeFrameNavigation(direction, controller);
      const result = await findAdjacentMessagePathMatch({
        path,
        direction,
        fromTime,
        startTime: activeData.startTime,
        endTime: activeData.endTime,
        windowDuration: requestWindowDuration,
        subscribeMessageRange: activeSubscribeMessageRange,
        getMessagePathDataItems,
        abortSignal: controller.signal,
      });

      if (activeRangeNavigation.current !== controller) {
        return;
      }
      activeRangeNavigation.current = undefined;
      handleRangeNavigationResult(direction, result);
    },
    [
      activeData,
      activeSubscribeMessageRange,
      beginRangeFrameNavigation,
      currentMessagesRef,
      getMessagePathDataItems,
      handleRangeNavigationResult,
      path,
      requestWindowDuration,
      seekPlayback,
    ],
  );

  const handlePreviousFrame = useCallback(() => {
    if (
      activeSubscribeMessageRange != undefined &&
      activeData != undefined &&
      seekPlayback != undefined &&
      path.length > 0
    ) {
      void runRangeFrameNavigation("previous");
      return;
    }

    runFallbackPreviousFrame();
  }, [
    activeData,
    activeSubscribeMessageRange,
    path,
    runFallbackPreviousFrame,
    runRangeFrameNavigation,
    seekPlayback,
  ]);

  const handleNextFrame = useCallback(
    (currentMessages?: MessageAndData[]) => {
      if (currentMessages) {
        currentMessagesRef.current = currentMessages;
      }

      if (
        activeSubscribeMessageRange != undefined &&
        activeData != undefined &&
        seekPlayback != undefined &&
        path.length > 0
      ) {
        void runRangeFrameNavigation("next");
        return;
      }

      runFallbackNextFrame(currentMessages);
    },
    [
      activeData,
      activeSubscribeMessageRange,
      path,
      runFallbackNextFrame,
      runRangeFrameNavigation,
      seekPlayback,
    ],
  );

  const handleNextFrameFromKeyboard = useCallback(() => {
    handleNextFrame(currentMessagesRef.current);
  }, [currentMessagesRef, handleNextFrame]);

  const keyboardActions = useMemo(
    () => ({
      onPreviousFrame: handlePreviousFrame,
      onNextFrame: handleNextFrameFromKeyboard,
    }),
    [handleNextFrameFromKeyboard, handlePreviousFrame],
  );
  const { panelRef, keyDownHandlers, keyUpHandlers } = useFrameNavigationKeyboard(keyboardActions);

  useEffect(() => {
    return () => {
      if (cancelActiveRangeNavigation()) {
        frameNavigationNotifier.endNavigation(navigationId.current);
      }
    };
  }, [cancelActiveRangeNavigation]);

  useEffect(() => {
    finishFrameNavigation();
    resetRenderedHistory();
  }, [finishFrameNavigation, getMessagePathDataItems, path, resetRenderedHistory]);

  useEffect(() => {
    setRangeNavigationUnsupported(false);
  }, [path, playerId, subscribeMessageRange]);

  return {
    hasPreFrame,
    handlePreviousFrame,
    handleNextFrame,
    onRestore,
    getEffectiveMessages,
    updateRenderedTime,
    keyDownHandlers,
    keyUpHandlers,
    panelRef,
    isFrameNavigationPending,
  };
}
