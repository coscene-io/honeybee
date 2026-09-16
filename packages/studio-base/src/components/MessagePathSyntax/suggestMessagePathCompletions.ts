// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { MessagePathStructureItem, parseMessagePath } from "@foxglove/message-path";

import {
  ARRAY_FUNCTION_NAMES,
  MessagePathFunctionSupport,
  OPERAND_FUNCTION_NAMES,
  SCALAR_FUNCTION_NAMES,
  STRUCT_FIELD_ACCESS,
  TIME_SERIES_FUNCTION_NAMES,
  VECTOR_FUNCTION_NAMES,
  validateMessagePathFunctions,
} from "./messagePathFunctions";

function isNumericPrimitive(item: MessagePathStructureItem | undefined): boolean {
  return (
    item?.structureType === "primitive" &&
    item.primitiveType !== "string" &&
    item.primitiveType !== "bool"
  );
}

function hasNumericFields(
  item: Extract<MessagePathStructureItem, { structureType: "message" }>,
  names: readonly string[],
): boolean {
  return names.every((name) => isNumericPrimitive(item.nextByName[name]));
}

function appendScalarAndOperandSuffixes(items: string[]): void {
  for (const name of SCALAR_FUNCTION_NAMES) {
    items.push(`@${name}`);
  }
  for (const name of OPERAND_FUNCTION_NAMES) {
    items.push(`@${name}(`);
  }
}

function appendTimeSeriesSuffixes(
  items: string[],
  support: MessagePathFunctionSupport,
): void {
  if (support.supportsTimeSeriesMessagePathFunctions !== true) {
    return;
  }
  for (const name of TIME_SERIES_FUNCTION_NAMES) {
    items.push(`@${name}`);
  }
}

export function suggestFunctionSuffixes(args: {
  terminatingItem: MessagePathStructureItem | undefined;
  support: MessagePathFunctionSupport;
}): string[] {
  const { terminatingItem, support } = args;
  if (support.supportsMessagePathFunctions !== true || terminatingItem == undefined) {
    return [];
  }

  const items: string[] = [];

  switch (terminatingItem.structureType) {
    case "primitive":
      if (isNumericPrimitive(terminatingItem)) {
        appendScalarAndOperandSuffixes(items);
        appendTimeSeriesSuffixes(items, support);
      }
      break;
    case "array":
      for (const name of ARRAY_FUNCTION_NAMES) {
        items.push(`@${name}`);
      }
      appendScalarAndOperandSuffixes(items);
      break;
    case "message": {
      if (hasNumericFields(terminatingItem, ["x", "y"])) {
        for (const name of VECTOR_FUNCTION_NAMES) {
          items.push(`@${name}`);
        }
      }
      if (hasNumericFields(terminatingItem, ["x", "y", "z", "w"])) {
        for (const name of ["rpy", "ypr", "yrp"] as const) {
          for (const field of STRUCT_FIELD_ACCESS[name] ?? []) {
            items.push(`@${name}.${field}`);
          }
        }
      }
      if (hasNumericFields(terminatingItem, ["roll", "pitch", "yaw"])) {
        for (const field of STRUCT_FIELD_ACCESS.quat ?? []) {
          items.push(`@quat.${field}`);
        }
      }
      break;
    }
  }

  return items;
}

export function validateMessagePathInput(
  path: string,
  support: MessagePathFunctionSupport,
): string | undefined {
  if (path.trim().length === 0) {
    return undefined;
  }
  if (support.supportsMessagePathFunctions !== true && path.includes(".@")) {
    return "This field does not accept functions";
  }

  const parsed = parseMessagePath(path);
  if (parsed == undefined) {
    return "Invalid expression";
  }
  if (!parsed.isFullySpecified) {
    if (path.includes(".@") || path.includes("{")) {
      return undefined;
    }
    return "Invalid expression";
  }
  if (parsed.functionChain == undefined || parsed.functionChain.length === 0) {
    return undefined;
  }
  return validateMessagePathFunctions(parsed, support);
}
