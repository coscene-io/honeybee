// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePath, parseFunction } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";
import { MessageEvent } from "@foxglove/studio-base/players/types";
import { isTypedArray } from "@foxglove/studio-base/types/isTypedArray";

import { filterMatches } from "./filterMatches";
import {
  applyFunctionChain,
  MessagePathFunctionSupport,
  validateMessagePathFunctions,
} from "./messagePathFunctions";

const SIMPLE_PATH_FUNCTION_SUPPORT: MessagePathFunctionSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: false,
  globalVariables: {},
};

/**
 * Settings error for a path that panels evaluate with `simpleGetMessagePathDataItems` and without
 * global variables (Gauge, Indicator): `$variables` are unsupported anywhere in the path, and a
 * completed function chain must be valid for a non-time-series field.
 */
export function validateSimpleMessagePath(parsed: MessagePath | undefined): string | undefined {
  if (parsed == undefined) {
    return undefined;
  }
  const usesVariables =
    parsed.messagePath.some(
      (part) =>
        (part.type === "filter" && typeof part.value === "object") ||
        (part.type === "slice" && (typeof part.start === "object" || typeof part.end === "object")),
    ) ||
    (parsed.functionChain ?? []).some(
      (step) => parseFunction(step.function)?.operandRaw?.startsWith("$") === true,
    );
  if (usesVariables) {
    return "Message paths using variables are not currently supported";
  }
  if (!parsed.isFullySpecified) {
    return undefined;
  }
  return validateMessagePathFunctions(parsed, SIMPLE_PATH_FUNCTION_SUPPORT);
}

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
        // Negative bounds count from the end; clamping to [0, length) also keeps a non-finite
        // bound (oversized literal or `$var`) from turning into an endless loop.
        const startIdx = Math.max(start < 0 ? length + start : start, 0);
        const endIdx = Math.min(end < 0 ? length + end : end, length - 1);
        for (let index = startIdx; index <= endIdx; index++) {
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
