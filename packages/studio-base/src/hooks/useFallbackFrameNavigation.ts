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

export function useFallbackFrameNavigation(args: UseFallbackFrameNavigationArgs): {
  readonly hasPreFrame: boolean;
  readonly currentMessagesRef: MutableRefObject<MessageAndData[]>;
  readonly freezeCurrentMessages: () => void;
  readonly clearFrozenMessages: () => void;
  readonly resetRenderedHistory: () => void;
  readonly restoreFallbackState: () => boolean;
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
  const frozenMessagesRef = useRef<MessageAndData[] | undefined>();
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
  }, []);

  const resetRenderedHistory = useCallback(() => {
    renderedTime.current = [];
    fallbackNextFrameActive.current = false;
    fallbackNextStartTime.current = undefined;
    setHasPreFrame(false);
  }, []);

  const restoreFallbackState = useCallback((): boolean => {
    if (
      frameState.current === "current" &&
      notifier.isOtherNavigationActive(navigationId.current)
    ) {
      return false;
    }

    if (frameState.current === "current") {
      resetRenderedHistory();
      return false;
    }

    frameState.current = "current";
    fallbackNextFrameActive.current = false;
    fallbackNextStartTime.current = undefined;
    notifier.endNavigation(navigationId.current);
    clearFrozenMessages();
    return true;
  }, [clearFrozenMessages, frameState, navigationId, notifier, resetRenderedHistory]);

  const runFallbackPreviousFrame = useCallback((): boolean => {
    if (frameState.current !== "current" || renderedTime.current.length <= 1) {
      return false;
    }

    pausePlayback?.();
    notifier.startNavigation(navigationId.current);
    fallbackNextFrameActive.current = false;
    frameState.current = "previous";

    renderedTime.current.pop();
    const previousTime = renderedTime.current.at(-1);
    if (previousTime != undefined) {
      seekPlayback?.(previousTime);
    }

    if (renderedTime.current.length <= 1) {
      setHasPreFrame(false);
    }
    return true;
  }, [frameState, navigationId, notifier, pausePlayback, seekPlayback]);

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
      if (frameState.current !== "current" && frozenMessagesRef.current != undefined) {
        return frozenMessagesRef.current as T;
      }
      return messages;
    },
    [frameState],
  );

  const updateRenderedTime = useCallback(
    (messages: MessageAndData[]) => {
      currentMessagesRef.current = messages;
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
        const newMessageTimes =
          latestRenderedTime == undefined
            ? messageTimes
            : messageTimes.filter((messageTime) => compare(messageTime, latestRenderedTime) > 0);
        renderedTime.current = renderedTime.current.concat(newMessageTimes);
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
        renderedTime.current = renderedTime.current.concat(messageTimes);
      }

      if (renderedTime.current.length > MAX_RENDERED_TIME_ARRAY_LENGTH) {
        renderedTime.current = renderedTime.current.slice(-MAX_RENDERED_TIME_ARRAY_LENGTH);
      }

      if (activeTimes == undefined && renderedTime.current.length > 1) {
        setHasPreFrame(true);
      }
    },
    [activeTimes, frameState, pausePlayback, seekPlayback],
  );

  return {
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
  };
}
