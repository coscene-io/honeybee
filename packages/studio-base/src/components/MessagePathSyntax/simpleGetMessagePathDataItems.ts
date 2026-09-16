// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePath } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";
import { MessageEvent } from "@foxglove/studio-base/players/types";
import { isTypedArray } from "@foxglove/studio-base/types/isTypedArray";

import { filterMatches } from "./filterMatches";
import { applyFunctionChain } from "./messagePathFunctions";

/**
 * Execute the given message path to extract item(s) from the message.
 */
export function simpleGetMessagePathDataItems(
  message: Immutable<MessageEvent>,
  filledInPath: Immutable<MessagePath>,
): unknown[] {
  // We don't care about messages that don't match the topic we're looking for.
  if (message.topic !== filledInPath.topicName) {
    return [];
  }

  const results: unknown[] = [];

  function traverse(value: unknown, pathIndex: number): void {
    const pathPart = filledInPath.messagePath[pathIndex];
    if (pathPart == undefined) {
      const nextValue = applyFunctionChain(value, filledInPath.functionChain);
      if (nextValue != undefined) {
        results.push(nextValue);
      }
      return;
    }
    if (value == undefined) {
      return;
    }
    switch (pathPart.type) {
      case "slice": {
        if (!Array.isArray(value) && !isTypedArray(value)) {
          return;
        }
        if (typeof pathPart.start === "object" || typeof pathPart.end === "object") {
          throw new Error("Variables in slices are not supported");
        }
        const { start, end } = pathPart;
        const length = value.length;
        const startIdx = start < 0 ? length + start : start;
        const endIdx = end === Infinity ? length - 1 : end < 0 ? length + end : end;
        for (let index = startIdx; index <= endIdx; index++) {
          if (index < 0 || index >= length) {
            continue;
          }
          traverse(value[index], pathIndex + 1);
        }
        return;
      }
      case "filter":
        if (!filterMatches(pathPart, value)) {
          return undefined;
        }
        traverse(value, pathIndex + 1);
        return;
      case "name":
        if (typeof value !== "object") {
          return undefined;
        }
        traverse((value as Record<string, unknown>)[pathPart.name], pathIndex + 1);
        return;
    }
  }
  traverse(message.message, 0);

  return results;
}
