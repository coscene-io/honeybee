// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { v4 as uuidv4 } from "uuid";

import { compare, fromSec } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
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
  useMessagePipelineGetter,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";
import { getRequestWindowDefaultTime } from "@foxglove/studio-base/constants/appSettingsDefaults";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

import { frameNavigationNotifier } from "./FrameNavigationNotifier";
import {
  type FrameNavigationState,
  useFallbackFrameNavigation,
} from "./useFallbackFrameNavigation";
import { type KeyHandlers, useFrameNavigationKeyboard } from "./useFrameNavigationKeyboard";

// Selector functions for player controls
const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectStartPlayback = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPausePlayback = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectSubscribeMessageRange = (ctx: MessagePipelineContext) => ctx.subscribeMessageRange;
const selectActiveData = (ctx: MessagePipelineContext) => ctx.playerState.activeData;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

const SEARCH_FEEDBACK_DELAY_MS = 2_000;

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
  frameNavigationStatusMessage: string | undefined;
  cancelFrameNavigation: () => void;
}

type UseFrameNavigationOptions = {
  readonly path?: string;
  readonly noPreviousFrameMessage?: string;
  readonly noNextFrameMessage?: string;
  readonly searchingPreviousFrameMessage?: string;
  readonly searchingNextFrameMessage?: string;
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
    searchingPreviousFrameMessage = "Searching for previous matching frame…",
    searchingNextFrameMessage = "Searching for next matching frame…",
  } = options;
  // Player control hooks
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const startPlayback = useMessagePipeline(selectStartPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);
  const subscribeMessageRange = useMessagePipeline(selectSubscribeMessageRange);
  const activeData = useMessagePipeline(selectActiveData);
  const playerId = useMessagePipeline(selectPlayerId);
  const getMessagePipelineState = useMessagePipelineGetter();
  const getMessagePathDataItems = useCachedGetMessagePathDataItems(path.length > 0 ? [path] : []);
  const { enqueueSnackbar } = useSnackbar();

  const [isFrameNavigationPending, setIsFrameNavigationPending] = useState(false);
  const [frameNavigationStatusMessage, setFrameNavigationStatusMessage] = useState<
    string | undefined
  >();
  const [configuredRequestWindow] = useAppConfigurationValue<number>(AppSetting.REQUEST_WINDOW);
  const requestWindowDuration = useMemo(() => {
    return typeof configuredRequestWindow === "number" && configuredRequestWindow > 0
      ? fromSec(configuredRequestWindow)
      : getRequestWindowDefaultTime();
  }, [configuredRequestWindow]);

  // Unique identifier for this hook instance
  const navigationId = useRef(uuidv4());

  // Flag bit to indicate that the next message is the previous frame, current frame, next frame.
  const frameState = useRef<FrameNavigationState>("current");
  const activeRangeNavigation = useRef<AbortController | undefined>();
  const manualSeekTime = useRef<Time | undefined>();
  const lastRestoreContext = useRef({
    playerId,
    lastSeekTime: activeData?.lastSeekTime,
  });
  const nextRangeExhausted = useRef(false);
  const previousRangeExhausted = useRef(false);
  const searchFeedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>();

  const activeTimes = useMemo(() => {
    return activeData != undefined
      ? { currentTime: activeData.currentTime, startTime: activeData.startTime }
      : undefined;
  }, [activeData]);
  const {
    hasPreFrame,
    currentMessagesRef,
    freezeCurrentMessages,
    clearFrozenMessages,
    holdNavigationMessages,
    markPreviousFrameUnavailable,
    resetRenderedHistory,
    restoreFallbackState,
    runPreviousFrameFromRenderedHistory,
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
    activeTimes: subscribeMessageRange != undefined && path.length > 0 ? activeTimes : undefined,
    playbackTime: activeData?.currentTime,
  });

  const clearSearchFeedback = useCallback(() => {
    if (searchFeedbackTimer.current != undefined) {
      clearTimeout(searchFeedbackTimer.current);
      searchFeedbackTimer.current = undefined;
    }
    setFrameNavigationStatusMessage(undefined);
  }, []);

  const cancelActiveRangeNavigation = useCallback(() => {
    activeRangeNavigation.current?.abort();
    activeRangeNavigation.current = undefined;
    clearSearchFeedback();
  }, [clearSearchFeedback]);

  const finishFrameNavigation = useCallback(() => {
    cancelActiveRangeNavigation();
    frameState.current = "current";
    frameNavigationNotifier.endNavigation(navigationId.current);
    clearFrozenMessages();
    setIsFrameNavigationPending(false);
  }, [cancelActiveRangeNavigation, clearFrozenMessages]);

  const beginRangeFrameNavigation = useCallback(
    (direction: FrameNavigationDirection, controller: AbortController) => {
      clearSearchFeedback();
      activeRangeNavigation.current = controller;
      freezeCurrentMessages();
      pausePlayback?.();
      frameNavigationNotifier.startNavigation(navigationId.current, () => {
        if (
          activeRangeNavigation.current === controller ||
          (activeRangeNavigation.current == undefined && frameState.current !== "current")
        ) {
          finishFrameNavigation();
        }
      });
      frameState.current = direction;
      setIsFrameNavigationPending(true);
      searchFeedbackTimer.current = setTimeout(() => {
        searchFeedbackTimer.current = undefined;
        if (activeRangeNavigation.current !== controller) {
          return;
        }
        setFrameNavigationStatusMessage(
          direction === "previous" ? searchingPreviousFrameMessage : searchingNextFrameMessage,
        );
      }, SEARCH_FEEDBACK_DELAY_MS);
    },
    [
      clearSearchFeedback,
      freezeCurrentMessages,
      finishFrameNavigation,
      pausePlayback,
      searchingNextFrameMessage,
      searchingPreviousFrameMessage,
    ],
  );

  const onRestore = useCallback(() => {
    const latestPipelineState = getMessagePipelineState();
    const latestActiveData = selectActiveData(latestPipelineState);
    const latestRestoreContext = {
      playerId: selectPlayerId(latestPipelineState),
      lastSeekTime: latestActiveData?.lastSeekTime,
    };
    const previousRestoreContext = lastRestoreContext.current;
    lastRestoreContext.current = latestRestoreContext;
    const restoredAfterSeek =
      latestActiveData != undefined &&
      previousRestoreContext.playerId === latestRestoreContext.playerId &&
      previousRestoreContext.lastSeekTime != undefined &&
      latestRestoreContext.lastSeekTime !== previousRestoreContext.lastSeekTime;

    if (activeRangeNavigation.current != undefined) {
      if (restoredAfterSeek) {
        manualSeekTime.current = latestActiveData.currentTime;
        currentMessagesRef.current = [];
      }
      finishFrameNavigation();
      resetRenderedHistory();
      return;
    }

    clearSearchFeedback();
    switch (restoreFallbackState()) {
      case "restored":
        manualSeekTime.current = undefined;
        setIsFrameNavigationPending(false);
        return;
      case "manual-seek":
        if (restoredAfterSeek) {
          manualSeekTime.current = latestActiveData.currentTime;
          currentMessagesRef.current = [];
        } else {
          manualSeekTime.current = undefined;
        }
        return;
      case "other-navigation":
        return;
    }
  }, [
    clearSearchFeedback,
    currentMessagesRef,
    finishFrameNavigation,
    getMessagePipelineState,
    resetRenderedHistory,
    restoreFallbackState,
  ]);

  const handleRangeNavigationResult = useCallback(
    (
      direction: FrameNavigationDirection,
      result: AdjacentMessagePathMatchResult,
      context: {
        readonly rangeStartTime: Time;
        readonly rangeCurrentTime: Time;
        readonly rangeEndTime: Time;
        readonly wasPlaying: boolean;
      },
    ) => {
      clearSearchFeedback();
      switch (result.type) {
        case "found": {
          currentMessagesRef.current = [result.message];
          holdNavigationMessages([result.message]);
          const targetTime = result.message.messageEvent.receiveTime;
          const latestActiveData = selectActiveData(getMessagePipelineState());
          if (
            latestActiveData != undefined &&
            compare(targetTime, latestActiveData.currentTime) === 0
          ) {
            onRestore();
            return;
          }
          seekPlayback?.(targetTime);
          return;
        }
        case "notFound": {
          const latestActiveData = selectActiveData(getMessagePipelineState());
          if (direction === "previous") {
            if (
              latestActiveData != undefined &&
              compare(latestActiveData.startTime, context.rangeStartTime) === 0 &&
              compare(latestActiveData.currentTime, context.rangeCurrentTime) === 0
            ) {
              previousRangeExhausted.current = true;
              markPreviousFrameUnavailable();
            }
          } else {
            if (
              latestActiveData != undefined &&
              compare(latestActiveData.currentTime, context.rangeCurrentTime) === 0 &&
              compare(latestActiveData.endTime, context.rangeEndTime) === 0
            ) {
              nextRangeExhausted.current = true;
            }
          }
          finishFrameNavigation();
          setFrameNavigationStatusMessage(
            direction === "previous" ? noPreviousFrameMessage : noNextFrameMessage,
          );
          return;
        }
        case "unsupported": {
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
            if (context.wasPlaying) {
              startPlayback?.();
            }
          }
          return;
        }
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
      clearSearchFeedback,
      enqueueSnackbar,
      finishFrameNavigation,
      getMessagePipelineState,
      holdNavigationMessages,
      markPreviousFrameUnavailable,
      noNextFrameMessage,
      noPreviousFrameMessage,
      onRestore,
      resetRenderedHistory,
      runFallbackNextFrame,
      runFallbackPreviousFrame,
      seekPlayback,
      startPlayback,
    ],
  );

  const runRangeFrameNavigation = useCallback(
    async (direction: FrameNavigationDirection, rangeFromTime?: Time) => {
      if (frameState.current !== "current") {
        return;
      }
      if (
        subscribeMessageRange == undefined ||
        activeData == undefined ||
        seekPlayback == undefined ||
        path.length === 0
      ) {
        return;
      }

      const latestMessage = currentMessagesRef.current[currentMessagesRef.current.length - 1];
      const restoredSeekTime = manualSeekTime.current;
      const fromTime =
        rangeFromTime ??
        restoredSeekTime ??
        latestMessage?.messageEvent.receiveTime ??
        activeData.currentTime;
      const controller = new AbortController();
      const wasPlaying = activeData.isPlaying;

      beginRangeFrameNavigation(direction, controller);
      let searchFromTime = fromTime;
      let result: AdjacentMessagePathMatchResult;
      do {
        result = await findAdjacentMessagePathMatch({
          path,
          direction,
          fromTime: searchFromTime,
          startTime: activeData.startTime,
          endTime: activeData.endTime,
          windowDuration: requestWindowDuration,
          subscribeMessageRange,
          getMessagePathDataItems,
          abortSignal: controller.signal,
        });
        searchFromTime = activeData.currentTime;
      } while (
        direction === "previous" &&
        result.type === "found" &&
        compare(result.message.messageEvent.receiveTime, activeData.currentTime) === 0
      );

      if (activeRangeNavigation.current !== controller) {
        return;
      }
      if (!frameNavigationNotifier.isNavigationActive(navigationId.current)) {
        finishFrameNavigation();
        return;
      }
      activeRangeNavigation.current = undefined;
      handleRangeNavigationResult(direction, result, {
        rangeStartTime: activeData.startTime,
        rangeCurrentTime: activeData.currentTime,
        rangeEndTime: activeData.endTime,
        wasPlaying,
      });
    },
    [
      activeData,
      beginRangeFrameNavigation,
      currentMessagesRef,
      finishFrameNavigation,
      getMessagePathDataItems,
      handleRangeNavigationResult,
      path,
      requestWindowDuration,
      seekPlayback,
      subscribeMessageRange,
    ],
  );

  const handlePreviousFrame = useCallback(() => {
    if (seekPlayback == undefined || previousRangeExhausted.current) {
      return;
    }
    if (
      subscribeMessageRange != undefined &&
      activeData != undefined &&
      path.length > 0
    ) {
      const latestMessage = currentMessagesRef.current[currentMessagesRef.current.length - 1];
      const fromTime =
        manualSeekTime.current ?? latestMessage?.messageEvent.receiveTime ?? activeData.currentTime;
      if (runPreviousFrameFromRenderedHistory(fromTime)) {
        return;
      }
      void runRangeFrameNavigation("previous", fromTime);
      return;
    }

    runFallbackPreviousFrame();
  }, [
    activeData,
    currentMessagesRef,
    path,
    runFallbackPreviousFrame,
    runPreviousFrameFromRenderedHistory,
    runRangeFrameNavigation,
    seekPlayback,
    subscribeMessageRange,
  ]);

  const handleNextFrame = useCallback(
    (currentMessages?: MessageAndData[]) => {
      if (seekPlayback == undefined) {
        return;
      }
      if (nextRangeExhausted.current) {
        setFrameNavigationStatusMessage(noNextFrameMessage);
        return;
      }
      if (frameState.current !== "current") {
        return;
      }
      if (currentMessages) {
        currentMessagesRef.current = getEffectiveMessages(currentMessages);
      }

      if (
        subscribeMessageRange != undefined &&
        activeData != undefined &&
        path.length > 0
      ) {
        void runRangeFrameNavigation("next");
        return;
      }

      runFallbackNextFrame(currentMessagesRef.current);
    },
    [
      activeData,
      getEffectiveMessages,
      noNextFrameMessage,
      path,
      runFallbackNextFrame,
      runRangeFrameNavigation,
      seekPlayback,
      subscribeMessageRange,
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
    if (
      manualSeekTime.current != undefined &&
      activeData != undefined &&
      compare(manualSeekTime.current, activeData.currentTime) !== 0
    ) {
      manualSeekTime.current = undefined;
    }
    nextRangeExhausted.current = false;
    previousRangeExhausted.current = false;
  }, [activeData?.currentTime.nsec, activeData?.currentTime.sec]);

  useEffect(() => {
    nextRangeExhausted.current = false;
  }, [activeData?.endTime.nsec, activeData?.endTime.sec]);

  useEffect(() => {
    return () => {
      cancelActiveRangeNavigation();
      frameNavigationNotifier.cancelNavigation(navigationId.current);
    };
  }, [cancelActiveRangeNavigation]);

  useEffect(() => {
    manualSeekTime.current = undefined;
    nextRangeExhausted.current = false;
    previousRangeExhausted.current = false;
    finishFrameNavigation();
    resetRenderedHistory();
  }, [
    activeData?.startTime.nsec,
    activeData?.startTime.sec,
    finishFrameNavigation,
    getMessagePathDataItems,
    path,
    playerId,
    resetRenderedHistory,
    subscribeMessageRange,
  ]);

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
    frameNavigationStatusMessage,
    cancelFrameNavigation: finishFrameNavigation,
  };
}
