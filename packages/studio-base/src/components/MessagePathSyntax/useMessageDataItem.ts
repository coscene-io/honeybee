// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useCallback, useMemo } from "react";

import { useMessageReducer } from "@foxglove/studio-base/PanelAPI";
import { subscribePayloadFromMessagePath } from "@foxglove/studio-base/players/subscribePayloadFromMessagePath";
import { MessageEvent, SubscribePayload } from "@foxglove/studio-base/players/types";

import {
  MessageAndData,
  useCachedGetMessagePathDataItems,
} from "./useCachedGetMessagePathDataItems";

type Options = {
  // messagePipeline 会分发每个渲染帧时间范围内的所有消息，比如如果现在设置的是一秒 60 帧，
  // 那么 messagePipeline 就会每次分发 1/60 秒内的所有消息,
  // 正常情况下只需要在意并且渲染离当前时间最接近的消息，也就是数组内最后一条消息
  // 所以默认情况下 historySize 设置为 1
  // 但是有些情况下需要返回多帧消息，比如和上一帧数据进行对比时，就需要返回最近的两帧
  // 这时候就需要把 historySize 设置为 2
  // 但是还有更极端的情况，比如我们记住每一帧的时间戳，方便用户返回上一帧，这时候就要返回一个渲染帧内所有的消息
  // 这时候就需要把 historySize 设置为 "all"

  // messagePipeline will dispatch all messages within a render frame, for example, if the current
  // setting is 60 frames per second, messagePipeline will dispatch all messages within 1/60 seconds.
  // Normally, you only need to pay attention to and render the message closest to the current time,
  // which is the last message in the array.
  // so the default historySize is 1.
  // But in some cases, you need to return multiple frames of messages, for example, when comparing
  // with the previous frame, you need to return the last two frames.
  // In this case, you need to set historySize to 2.
  // But in some cases, you need to return all messages within a render frame, for example, when
  // remembering the timestamp of each frame, you need to return all messages within a render frame.
  // In this case, you need to set historySize to "all".
  historySize: number | "all";

  onRestore?: () => void;
};

type ReducedValue = {
  // Matched message (events) oldest message first
  matches: MessageAndData[];

  // The latest set of message events recevied to addMessages
  messageEvents: readonly Readonly<MessageEvent>[];

  // The path used to match these messages.
  path: string;
};

/**
 * Return an array of MessageAndData[] for matching messages on @param path.
 *
 * The first array item is the oldest matched message, and the last item is the newest.
 *
 * The `historySize` option configures how many matching messages to keep. The default is 1.
 */
export function useMessageDataItem(path: string, options?: Options): ReducedValue["matches"] {
  const { historySize = 1, onRestore } = options ?? {};
  const topics: SubscribePayload[] = useMemo(() => {
    const payload = subscribePayloadFromMessagePath(path, "partial");
    if (payload) {
      return [payload];
    }
    return [];
  }, [path]);

  const cachedGetMessagePathDataItems = useCachedGetMessagePathDataItems([path]);

  const addMessages = useCallback(
    (prevValue: ReducedValue, messageEvents: Readonly<MessageEvent[]>): ReducedValue => {
      if (messageEvents.length === 0) {
        return prevValue;
      }

      const realHistorySize = historySize === "all" ? messageEvents.length : historySize;

      const newMatches: MessageAndData[] = [];

      // Iterate backwards since our default history size is 1 and we might not need to visit all messages
      // This does mean we need to flip newMatches around since we want to store older items first
      for (let i = messageEvents.length - 1; i >= 0 && newMatches.length < realHistorySize; --i) {
        const messageEvent = messageEvents[i]!;
        const queriedData = cachedGetMessagePathDataItems(path, messageEvent);
        if (queriedData && queriedData.length > 0) {
          newMatches.push({ messageEvent, queriedData });
        }
      }

      // We want older items to be first in the array. Since we iterated backwards
      // we reverse the matches.
      const reversed = newMatches.reverse();
      if (newMatches.length === historySize) {
        return {
          matches: reversed,
          messageEvents,
          path,
        };
      }

      const prevMatches = prevValue.matches;
      return {
        matches: prevMatches.concat(reversed).slice(-realHistorySize),
        messageEvents,
        path,
      };
    },
    [cachedGetMessagePathDataItems, historySize, path],
  );

  const restore = useCallback(
    (prevValue?: ReducedValue): ReducedValue => {
      onRestore?.();

      if (!prevValue) {
        return {
          matches: [],
          messageEvents: [],
          path,
        };
      }

      // re-filter the previous batch of messages
      const newMatches: MessageAndData[] = [];
      for (const messageEvent of prevValue.messageEvents) {
        const queriedData = cachedGetMessagePathDataItems(path, messageEvent);
        if (queriedData && queriedData.length > 0) {
          newMatches.push({ messageEvent, queriedData });
        }
      }

      const realHistorySize = historySize === "all" ? newMatches.length : historySize;
      // Return a new message set if we have matching messages or this is a different path
      // than the path used to fetch the previous set of messages.
      if (newMatches.length > 0 || path !== prevValue.path) {
        return {
          matches: newMatches.slice(-realHistorySize),
          messageEvents: prevValue.messageEvents,
          path,
        };
      }

      return prevValue;
    },
    [cachedGetMessagePathDataItems, historySize, path],
  );

  const reducedValue = useMessageReducer<ReducedValue>({
    topics,
    addMessages,
    restore,
  });

  return reducedValue.matches;
}
