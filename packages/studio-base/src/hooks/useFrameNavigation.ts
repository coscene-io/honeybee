// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import { compare, Time } from "@foxglove/rostime";
import { MessageAndData } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  useMessagePipeline,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";

// Maximum number of rendered time entries to keep in memory
const MAX_RENDERED_TIME_ARRAY_LENGTH = 1000;

// Selector functions for player controls
const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectStartPlayback = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPausePlayback = (ctx: MessagePipelineContext) => ctx.pausePlayback;

// 所有使用 useFrameNavigation 的 hook 共享一个通知器，避免多个面板同时进行帧导航时，互相影响
// 用于通知 onRestore 的调用是由其他面板的 previous/next 按钮触发的, 而不是用户的手动 seek
// 从而不要清空 renderedTime 的记录

// All hooks using useFrameNavigation share a notifier to avoid mutual interference when multiple panels are performing frame navigation at the same time
// Used to notify that the onRestore call is triggered by the previous/next button of another panel, rather than the user's manual seek
// So that the renderedTime record is not cleared
class FrameNavigationNotifier {
  #activeNavigationId: string | undefined = undefined;

  public startNavigation(navigationId: string): void {
    this.#activeNavigationId = navigationId;
  }

  public endNavigation(navigationId: string): void {
    if (this.#activeNavigationId === navigationId) {
      // 延迟清除状态，确保所有面板的 onRestore 都能检测到导航状态
      // Delay clearing state to ensure all panels' onRestore can detect navigation state
      setTimeout(() => {
        if (this.#activeNavigationId === navigationId) {
          this.#activeNavigationId = undefined;
        }
      }, 0);
    }
  }

  public isOtherNavigationActive(navigationId: string): boolean {
    return this.#activeNavigationId != undefined && this.#activeNavigationId !== navigationId;
  }
}

// Global notifier instance
const frameNavigationNotifier = new FrameNavigationNotifier();

// Key handlers for KeyListener component
type KeyHandlers = Record<string, (event: KeyboardEvent) => void | boolean | undefined>;

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
  panelRef: React.RefObject<HTMLDivElement>;
}

/**
 * Hook for frame navigation functionality (Previous/Next Frame)
 * Extracted from RawMessages panel for reuse across panels
 */
export function useFrameNavigation(): FrameNavigationHook {
  // Player control hooks
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const startPlayback = useMessagePipeline(selectStartPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);

  const [hasPreFrame, setHasPreFrame] = useState(false);

  // Unique identifier for this hook instance
  const navigationId = useRef(uuidv4());

  // Ref for panel container to enable focus detection
  // eslint-disable-next-line no-restricted-syntax
  const panelRef = useRef<HTMLDivElement>(null);

  // Flag bit to indicate that the next message is the previous frame, current frame, next frame.
  const frameState = useRef<"previous" | "current" | "next">("current");

  // 记录我们播放过的每一帧的时间戳，方便用户返回上一帧, 这里要注意⚠️ 在连续播放的情况下，用户看到的是渲染帧，比如当前以一秒 60 帧的速度播放，
  // 用户看到的是 1/60 秒这个时间范围内的最后一帧，如果频率很高，那么用户能看到的只占所有数据的很小一部分，但是我们需要记录所有数据的时间戳，
  // 而不是只记录渲染帧最后一帧的时间戳，这样才能保证用户在点击上一帧的时候看到的是上一条消息，而不是上一个渲染帧的最后一条消息

  // record the timestamp of each frame, so that the user can return to the previous frame, here
  // is the note ⚠️ in the continuous playback case, the user sees the rendered frame, for example,
  // if the current playback speed is 60 frames per second, the user sees the last frame of the
  // 1/60 second time range, if the frequency is high, then the user can only see a very small
  // part of the data, but we need to record the timestamp of all data, rather than just the last
  // frame of the rendered frame, so that the user can see the previous message when clicking the
  // previous frame, rather than the last frame of the previous rendered frame
  const renderedTime = useRef<Time[]>([]);

  // 用于保存next frame操作前的消息数据，避免在next状态下显示中间帧造成抖动
  // Save message data before next frame operation to avoid flickering from intermediate frames
  const frozenMessagesRef = useRef<MessageAndData[] | undefined>();

  // 保存当前消息数据，用于键盘快捷键
  // Save current messages for keyboard shortcuts
  const currentMessagesRef = useRef<MessageAndData[]>([]);

  // 如果用户是连续播放，我们需要记录播放过的所有消息的时间戳（包括未被展示的消息, 参考 rendedTime 的注释），
  // 但是如果用户手动跳转到一个时间位置，我们需要清空记录
  // 但是上一帧和下一帧的实际上也是一种跳转，所以我们需要一个标记位，来标记这次跳转是产生自用户点击上一帧/下一帧按钮，还是点击进度条跳转的
  // 我们将 onRestore 传入 useMessageDataItem, useMessageDataItem 会在每次监听到跳转之后调用这个函数，
  // onRestore 则需要根据 frameState 的值来决定清空还是保留记录

  // if the user is playing continuously, we need to record the timestamp of all messages (including
  // the messages that are not shown, reference the comment of rendedTime), but if the user manually
  // jumps to a time position, we need to clear the record
  // but the previous frame and the next frame are also a kind of jump, so we need a flag to mark
  // this jump is generated by the user clicking the previous frame/next frame button, or the progress
  // bar jump
  // we will pass onRestore to useMessageDataItem, useMessageDataItem will call this function after
  // receiving a jump, onRestore then needs to decide whether to clear or keep the record according
  // to the value of frameState
  const onRestore = useCallback(() => {
    // 如果有其他面板正在进行帧导航，不处理当前面板的状态
    // If another panel is performing frame navigation, don't handle current panel state
    if (
      frameState.current === "current" &&
      frameNavigationNotifier.isOtherNavigationActive(navigationId.current)
    ) {
      return;
    }

    if (frameState.current === "current") {
      renderedTime.current = [];
      setHasPreFrame(false);
    }

    if (frameState.current === "next" || frameState.current === "previous") {
      frameState.current = "current";
      // 通知帧导航结束
      // Notify frame navigation ended
      frameNavigationNotifier.endNavigation(navigationId.current);
      // 清除冻结状态，恢复正常显示
      // Clear frozen state and resume normal display
      frozenMessagesRef.current = undefined;
    }
  }, []);

  const handlePreviousFrame = useCallback(() => {
    if (renderedTime.current.length > 1) {
      pausePlayback?.();

      // 通知开始帧导航
      // Notify frame navigation started
      frameNavigationNotifier.startNavigation(navigationId.current);
      frameState.current = "previous";

      renderedTime.current.pop();
      if (renderedTime.current.length > 0) {
        seekPlayback?.(renderedTime.current[renderedTime.current.length - 1]!);
      }

      if (renderedTime.current.length <= 1) {
        setHasPreFrame(false);
      }
    }
  }, [pausePlayback, seekPlayback]);

  const handleNextFrame = useCallback(
    (currentMessages?: MessageAndData[]) => {
      // 防止连续快速点击时重复执行next操作
      // Prevent repeated next operations during rapid clicking
      if (frameState.current === "next") {
        return;
      }

      // 在开始next操作前冻结当前消息数据，避免显示中间帧
      // Freeze current message data before starting next operation to avoid intermediate frames
      if (currentMessages && currentMessages.length > 0) {
        frozenMessagesRef.current = [...currentMessages];
      }

      // 通知开始帧导航
      // Notify frame navigation started
      frameNavigationNotifier.startNavigation(navigationId.current);
      frameState.current = "next";
      startPlayback?.();
    },
    [startPlayback],
  );

  const getEffectiveMessages = useCallback(<T extends MessageAndData[]>(messages: T): T => {
    // 在next状态下使用冻结的消息数据，避免显示中间帧
    // Use frozen message data in next state to avoid showing intermediate frames
    if (frameState.current === "next" && frozenMessagesRef.current) {
      return frozenMessagesRef.current as T;
    }
    return messages;
  }, []);

  // Helper function to update rendered time based on messages
  // This should be called by the consuming component in useEffect
  const updateRenderedTime = useCallback(
    (messages: MessageAndData[]) => {
      // 保存当前消息，用于键盘快捷键
      // Save current messages for keyboard shortcuts
      currentMessagesRef.current = messages;

      if (messages.length === 0) {
        return;
      }

      // 上一帧的时间已经记录到 renderedTime 中，所以不需要添加对应帧的时间戳
      // the time of the previous frame has already been recorded in renderedTime, so no need to add
      if (frameState.current === "previous") {
        return;
      }

      const latestMessage = messages[0];

      if (frameState.current === "next" && latestMessage) {
        pausePlayback?.();
        seekPlayback?.(latestMessage.messageEvent.receiveTime);
        return;
      }

      if (latestMessage?.messageEvent.receiveTime) {
        const newTime = latestMessage.messageEvent.receiveTime;

        // Optimization: 99% of the time, new time is the largest value, so add directly to the end
        if (
          renderedTime.current.length === 0 ||
          compare(renderedTime.current[renderedTime.current.length - 1]!, newTime) < 0
        ) {
          // New time is greater than the last time in array, add directly to the end
          renderedTime.current = renderedTime.current.concat(
            messages.map((message) => message.messageEvent.receiveTime),
          );
        } else {
          // find the index of the time that is less than and closest to newTime
          let closestIndex = -1;
          for (let i = renderedTime.current.length - 1; i >= 0; i--) {
            if (compare(renderedTime.current[i]!, newTime) < 0) {
              closestIndex = i;
              break;
            }
          }

          // if a time is found, delete all elements after it
          if (closestIndex >= 0) {
            renderedTime.current = renderedTime.current.slice(0, closestIndex + 1);
          } else {
            // if no time is found, clear the array
            renderedTime.current = [];
          }

          // add the new time to the end of the array
          renderedTime.current = renderedTime.current.concat(
            messages.map((message) => message.messageEvent.receiveTime),
          );
        }
      }

      if (renderedTime.current.length > MAX_RENDERED_TIME_ARRAY_LENGTH) {
        renderedTime.current = renderedTime.current.slice(-MAX_RENDERED_TIME_ARRAY_LENGTH);
      }

      if (renderedTime.current.length > 1) {
        setHasPreFrame(true);
      }
    },
    [pausePlayback, seekPlayback],
  );

  // 键盘长按状态管理
  // Keyboard long press state management
  const keyRepeatState = useRef<{
    key: string | undefined;
    timeoutId: NodeJS.Timeout | undefined;
    intervalId: NodeJS.Timeout | undefined;
  }>({
    key: undefined,
    timeoutId: undefined,
    intervalId: undefined,
  });

  // 清除重复执行的定时器
  // Clear repeat execution timers
  const clearRepeatTimers = useCallback(() => {
    if (keyRepeatState.current.timeoutId != undefined) {
      clearTimeout(keyRepeatState.current.timeoutId);
      keyRepeatState.current.timeoutId = undefined;
    }
    if (keyRepeatState.current.intervalId != undefined) {
      clearInterval(keyRepeatState.current.intervalId);
      keyRepeatState.current.intervalId = undefined;
    }
    keyRepeatState.current.key = undefined;
  }, []);

  // 执行帧导航动作
  // Execute frame navigation action
  const executeFrameAction = useCallback(
    (key: string) => {
      switch (key) {
        case "ArrowUp":
          handlePreviousFrame();
          break;
        case "ArrowDown":
          handleNextFrame(currentMessagesRef.current);
          break;
        default:
          break;
      }
    },
    [handlePreviousFrame, handleNextFrame],
  );

  // 开始重复执行
  // Start repeat execution
  const startRepeatExecution = useCallback(
    (key: string) => {
      // 立即执行一次
      // Execute immediately once
      executeFrameAction(key);

      // 设置延迟后开始重复执行
      // Set delay before starting repeat execution
      keyRepeatState.current.timeoutId = setTimeout(() => {
        // 开始持续重复执行，使用较快的重复频率适合帧导航
        // Start continuous repeat execution with faster rate suitable for frame navigation
        keyRepeatState.current.intervalId = setInterval(() => {
          executeFrameAction(key);
        }, 150); // 每150ms重复一次，平衡响应性和控制性 / Repeat every 150ms, balancing responsiveness and control
      }, 400); // 400ms后开始重复，稍快响应 / Start repeating after 400ms for faster response
    },
    [executeFrameAction],
  );

  // 键盘快捷键处理器：上箭头 = Previous Frame, 下箭头 = Next Frame (支持长按)
  // Keyboard shortcut handlers: Up arrow = Previous Frame, Down arrow = Next Frame (supports long press)
  const keyDownHandlers = useMemo(
    (): KeyHandlers => ({
      ArrowUp: () => {
        // 检查面板是否有焦点
        // Check if panel has focus
        if (
          !panelRef.current ||
          !document.activeElement ||
          !panelRef.current.contains(document.activeElement)
        ) {
          return false; // 不 preventDefault，让其他组件处理
        }

        // 如果已经在处理同一个按键，则忽略
        // If already handling the same key, ignore
        if (keyRepeatState.current.key === "ArrowUp") {
          return true; // preventDefault
        }

        // 清除之前的定时器并开始新的重复执行
        // Clear previous timers and start new repeat execution
        clearRepeatTimers();
        keyRepeatState.current.key = "ArrowUp";
        startRepeatExecution("ArrowUp");

        return true; // preventDefault
      },
      ArrowDown: () => {
        // 检查面板是否有焦点
        // Check if panel has focus
        if (
          !panelRef.current ||
          !document.activeElement ||
          !panelRef.current.contains(document.activeElement)
        ) {
          return false; // 不 preventDefault，让其他组件处理
        }

        // 如果已经在处理同一个按键，则忽略
        // If already handling the same key, ignore
        if (keyRepeatState.current.key === "ArrowDown") {
          return true; // preventDefault
        }

        // 清除之前的定时器并开始新的重复执行
        // Clear previous timers and start new repeat execution
        clearRepeatTimers();
        keyRepeatState.current.key = "ArrowDown";
        startRepeatExecution("ArrowDown");

        return true; // preventDefault
      },
    }),
    [clearRepeatTimers, startRepeatExecution],
  );

  const keyUpHandlers = useMemo(
    (): KeyHandlers => ({
      ArrowUp: () => {
        // 检查面板是否有焦点
        // Check if panel has focus
        if (
          !panelRef.current ||
          !document.activeElement ||
          !panelRef.current.contains(document.activeElement)
        ) {
          return false; // 不 preventDefault，让其他组件处理
        }

        // 停止重复执行
        // Stop repeat execution
        if (keyRepeatState.current.key === "ArrowUp") {
          clearRepeatTimers();
        }
        return true; // preventDefault
      },
      ArrowDown: () => {
        // 检查面板是否有焦点
        // Check if panel has focus
        if (
          !panelRef.current ||
          !document.activeElement ||
          !panelRef.current.contains(document.activeElement)
        ) {
          return false; // 不 preventDefault，让其他组件处理
        }

        // 停止重复执行
        // Stop repeat execution
        if (keyRepeatState.current.key === "ArrowDown") {
          clearRepeatTimers();
        }
        return true; // preventDefault
      },
    }),
    [clearRepeatTimers],
  );

  // 组件卸载时清理定时器
  // Clean up timers when component unmounts
  useEffect(() => {
    return () => {
      clearRepeatTimers();
    };
  }, [clearRepeatTimers]);

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
  };
}
