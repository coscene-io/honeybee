// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { compare } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import type { MessageAndData } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";

import type { FrameNavigationNotifier } from "./FrameNavigationNotifier";

const MAX_RENDERED_TIME_ARRAY_LENGTH = 1000;

export type FrameNavigationState = "previous" | "current" | "next";

type ActiveTimes = {
  readonly currentTime: Time;
  readonly startTime: Time;
};

type UseFallbackFrameNavigationArgs = {
  readonly frameState: MutableRefObject<FrameNavigationState>;
  readonly navigationId: MutableRefObject<string>;
  readonly notifier: FrameNavigationNotifier;
  readonly seekPlayback: ((time: Time) => void) | undefined;
  readonly startPlayback: (() => void) | undefined;
  readonly pausePlayback: (() => void) | undefined;
  readonly activeTimes: ActiveTimes | undefined;
};

function hasTimeSuffix(times: readonly Time[], suffix: readonly Time[]): boolean {
  if (suffix.length > times.length) {
    return false;
  }

  const startIndex = times.length - suffix.length;
  return suffix.every((suffixTime, index) => {
    const time = times[startIndex + index];
    return time != undefined && compare(time, suffixTime) === 0;
  });
}

export type RestoreFallbackStateResult = "restored" | "manual-seek" | "other-navigation";

export function useFallbackFrameNavigation(args: UseFallbackFrameNavigationArgs): {
  readonly hasPreFrame: boolean;
  readonly currentMessagesRef: MutableRefObject<MessageAndData[]>;
  readonly freezeCurrentMessages: () => void;
  readonly clearFrozenMessages: () => void;
  readonly holdNavigationMessages: (messages: MessageAndData[]) => void;
  readonly resetRenderedHistory: () => void;
  readonly restoreFallbackState: () => RestoreFallbackStateResult;
  readonly runPreviousFrameToMessage: (message: MessageAndData) => boolean;
  readonly runPreviousFrameFromRenderedHistory: (fromTime: Time) => boolean;
  readonly runFallbackPreviousFrame: () => boolean;
  readonly runFallbackNextFrame: (currentMessages?: MessageAndData[]) => boolean;
  readonly getEffectiveMessages: <T extends MessageAndData[]>(messages: T) => T;
  readonly updateRenderedTime: (messages: MessageAndData[]) => void;
} {
  const {
    activeTimes,
    frameState,
    navigationId,
    notifier,
    pausePlayback,
    seekPlayback,
    startPlayback,
  } = args;
  const [hasPreFrame, setHasPreFrame] = useState(false);
  const renderedTime = useRef<Time[]>([]);
  const renderedMessages = useRef<MessageAndData[]>([]);
  const frozenMessagesRef = useRef<MessageAndData[] | undefined>();
  const keepFrozenMessagesAfterRestore = useRef(false);
  const heldNavigationTime = useRef<Time | undefined>();
  const currentMessagesRef = useRef<MessageAndData[]>([]);
  const fallbackNextFrameActive = useRef(false);
  const fallbackNextStartTime = useRef<Time | undefined>();

  const freezeCurrentMessages = useCallback(() => {
    if (currentMessagesRef.current.length > 0) {
      frozenMessagesRef.current = [...currentMessagesRef.current];
    }
  }, []);

  const clearFrozenMessages = useCallback(() => {
    frozenMessagesRef.current = undefined;
    keepFrozenMessagesAfterRestore.current = false;
    heldNavigationTime.current = undefined;
  }, []);

  const resetRenderedHistory = useCallback(() => {
    renderedTime.current = [];
    renderedMessages.current = [];
    fallbackNextFrameActive.current = false;
    fallbackNextStartTime.current = undefined;
    clearFrozenMessages();
    setHasPreFrame(false);
  }, [clearFrozenMessages]);

  const holdNavigationMessages = useCallback((messages: MessageAndData[]) => {
    frozenMessagesRef.current = messages;
    keepFrozenMessagesAfterRestore.current = true;
    heldNavigationTime.current = messages.at(-1)?.messageEvent.receiveTime;
  }, []);

  const restoreFallbackState = useCallback((): RestoreFallbackStateResult => {
    if (
      frameState.current === "current" &&
      notifier.isOtherNavigationActive(navigationId.current)
    ) {
      return "other-navigation";
    }

    if (frameState.current === "current") {
      resetRenderedHistory();
      return "manual-seek";
    }

    frameState.current = "current";
    fallbackNextFrameActive.current = false;
    fallbackNextStartTime.current = undefined;
    notifier.endNavigation(navigationId.current);
    if (!keepFrozenMessagesAfterRestore.current) {
      clearFrozenMessages();
    }
    return "restored";
  }, [clearFrozenMessages, frameState, navigationId, notifier, resetRenderedHistory]);

  const runPreviousFrameToMessage = useCallback(
    (message: MessageAndData): boolean => {
      if (frameState.current !== "current") {
        return false;
      }

      pausePlayback?.();
      notifier.startNavigation(navigationId.current);
      fallbackNextFrameActive.current = false;
      fallbackNextStartTime.current = undefined;
      frameState.current = "previous";
      currentMessagesRef.current = [message];
      holdNavigationMessages([message]);
      seekPlayback?.(message.messageEvent.receiveTime);
      if (activeTimes != undefined) {
        setHasPreFrame(compare(message.messageEvent.receiveTime, activeTimes.startTime) > 0);
      }
      return true;
    },
    [
      activeTimes,
      frameState,
      holdNavigationMessages,
      navigationId,
      notifier,
      pausePlayback,
      seekPlayback,
    ],
  );

  const runPreviousFrameFromRenderedHistory = useCallback(
    (fromTime: Time): boolean => {
      if (frameState.current !== "current") {
        return false;
      }

      let previousIndex = -1;
      for (let i = renderedMessages.current.length - 1; i >= 0; i--) {
        const message = renderedMessages.current[i];
        if (message != undefined && compare(message.messageEvent.receiveTime, fromTime) < 0) {
          previousIndex = i;
          break;
        }
      }
      const previousMessage = renderedMessages.current[previousIndex];
      if (previousMessage == undefined || !runPreviousFrameToMessage(previousMessage)) {
        return false;
      }

      renderedTime.current = renderedTime.current.slice(0, previousIndex + 1);
      renderedMessages.current = renderedMessages.current.slice(0, previousIndex + 1);
      if (activeTimes == undefined) {
        setHasPreFrame(previousIndex > 0);
      }
      return true;
    },
    [activeTimes, frameState, runPreviousFrameToMessage],
  );

  const runFallbackPreviousFrame = useCallback((): boolean => {
    if (frameState.current !== "current" || renderedTime.current.length <= 1) {
      return false;
    }

    const fromTime =
      currentMessagesRef.current.at(-1)?.messageEvent.receiveTime ??
      renderedMessages.current.at(-1)?.messageEvent.receiveTime;
    return fromTime != undefined && runPreviousFrameFromRenderedHistory(fromTime);
  }, [frameState, runPreviousFrameFromRenderedHistory]);

  const runFallbackNextFrame = useCallback(
    (currentMessages?: MessageAndData[]): boolean => {
      if (frameState.current !== "current") {
        return false;
      }

      if (currentMessages != undefined) {
        currentMessagesRef.current = currentMessages;
      }

      freezeCurrentMessages();
      notifier.startNavigation(navigationId.current);
      fallbackNextFrameActive.current = true;
      fallbackNextStartTime.current =
        currentMessagesRef.current.at(-1)?.messageEvent.receiveTime ?? activeTimes?.currentTime;
      frameState.current = "next";
      startPlayback?.();
      return true;
    },
    [activeTimes, frameState, freezeCurrentMessages, navigationId, notifier, startPlayback],
  );

  const getEffectiveMessages = useCallback(
    <T extends MessageAndData[]>(messages: T): T => {
      if (
        frozenMessagesRef.current != undefined &&
        (frameState.current !== "current" ||
          (keepFrozenMessagesAfterRestore.current && messages.length === 0))
      ) {
        return frozenMessagesRef.current as T;
      }
      return messages;
    },
    [frameState],
  );

  const updateRenderedTime = useCallback(
    (messages: MessageAndData[]) => {
      currentMessagesRef.current = messages;
      if (
        frameState.current === "current" &&
        messages.length > 0 &&
        keepFrozenMessagesAfterRestore.current &&
        messages.some((message) => {
          const heldTime = heldNavigationTime.current;
          return heldTime != undefined && compare(message.messageEvent.receiveTime, heldTime) === 0;
        })
      ) {
        clearFrozenMessages();
      }
      const latestMessage = messages.at(-1);
      const fallbackNextMessage = messages.find((msg) => {
        const startTime = fallbackNextStartTime.current;
        return startTime == undefined || compare(msg.messageEvent.receiveTime, startTime) > 0;
      });

      if (
        fallbackNextFrameActive.current &&
        frameState.current === "next" &&
        fallbackNextMessage != undefined
      ) {
        fallbackNextFrameActive.current = false;
        fallbackNextStartTime.current = undefined;
        holdNavigationMessages([fallbackNextMessage]);
        pausePlayback?.();
        seekPlayback?.(fallbackNextMessage.messageEvent.receiveTime);
        return;
      }

      if (activeTimes != undefined) {
        const currentMessageTime =
          latestMessage?.messageEvent.receiveTime ?? activeTimes.currentTime;
        setHasPreFrame(compare(currentMessageTime, activeTimes.startTime) > 0);
      }

      if (messages.length === 0 || frameState.current === "previous") {
        return;
      }

      const messageTimes = messages.map((message) => message.messageEvent.receiveTime);
      const newTime = messageTimes.at(-1);
      if (newTime == undefined) {
        return;
      }

      if (hasTimeSuffix(renderedTime.current, messageTimes)) {
        if (activeTimes == undefined && renderedTime.current.length > 1) {
          setHasPreFrame(true);
        }
        return;
      }

      const latestRenderedTime = renderedTime.current.at(-1);

      if (latestRenderedTime == undefined || compare(latestRenderedTime, newTime) < 0) {
        const newMessages =
          latestRenderedTime == undefined
            ? messages
            : messages.filter(
                (message) => compare(message.messageEvent.receiveTime, latestRenderedTime) > 0,
              );
        renderedTime.current = renderedTime.current.concat(
          newMessages.map((message) => message.messageEvent.receiveTime),
        );
        renderedMessages.current = renderedMessages.current.concat(newMessages);
      } else {
        let closestIndex = -1;
        for (let i = renderedTime.current.length - 1; i >= 0; i--) {
          const renderedEntry = renderedTime.current[i];
          if (renderedEntry != undefined && compare(renderedEntry, newTime) < 0) {
            closestIndex = i;
            break;
          }
        }

        renderedTime.current =
          closestIndex >= 0 ? renderedTime.current.slice(0, closestIndex + 1) : [];
        renderedMessages.current =
          closestIndex >= 0 ? renderedMessages.current.slice(0, closestIndex + 1) : [];
        renderedTime.current = renderedTime.current.concat(messageTimes);
        renderedMessages.current = renderedMessages.current.concat(messages);
      }

      if (renderedTime.current.length > MAX_RENDERED_TIME_ARRAY_LENGTH) {
        renderedTime.current = renderedTime.current.slice(-MAX_RENDERED_TIME_ARRAY_LENGTH);
        renderedMessages.current = renderedMessages.current.slice(-MAX_RENDERED_TIME_ARRAY_LENGTH);
      }

      if (activeTimes == undefined && renderedTime.current.length > 1) {
        setHasPreFrame(true);
      }
    },
    [
      activeTimes,
      clearFrozenMessages,
      frameState,
      holdNavigationMessages,
      pausePlayback,
      seekPlayback,
    ],
  );

  return {
    hasPreFrame,
    currentMessagesRef,
    freezeCurrentMessages,
    clearFrozenMessages,
    holdNavigationMessages,
    resetRenderedHistory,
    restoreFallbackState,
    runPreviousFrameToMessage,
    runPreviousFrameFromRenderedHistory,
    runFallbackPreviousFrame,
    runFallbackNextFrame,
    getEffectiveMessages,
    updateRenderedTime,
  };
}
