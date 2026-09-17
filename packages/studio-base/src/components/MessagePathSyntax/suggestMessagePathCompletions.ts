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

import {
  MessagePathFunction,
  MessagePathStructureItem,
  parseFunction,
  parseMessagePathWithDiagnostics,
} from "@foxglove/message-path";

import {
  ARRAY_FUNCTION_NAMES,
  MessagePathFunctionSupport,
  OPERAND_FUNCTION_NAMES,
  SCALAR_FUNCTION_NAMES,
  STRUCT_FIELD_ACCESS,
  TIME_SERIES_FUNCTION_NAMES,
  VECTOR_FUNCTION_NAMES,
  hasNumericFields,
  isNumericPrimitive,
  isNumericStructure,
  isVectorStructure,
  structureAfterFunctionChain,
  validateMessagePathFunctions,
} from "./messagePathFunctions";

function isTimeSeriesStep(step: MessagePathFunction): boolean {
  const name = parseFunction(step.function)?.name;
  return name != undefined && TIME_SERIES_FUNCTION_NAMES.includes(name);
}

/**
 * Function suffixes (`@abs`, `@mul(`, `@rpy.yaw`, ...) that can follow `terminatingItem` after
 * `functionChain` has already been applied to it.
 */
export function suggestFunctionSuffixes(args: {
  terminatingItem: MessagePathStructureItem | undefined;
  support: MessagePathFunctionSupport;
  functionChain?: readonly MessagePathFunction[];
  isTopic?: boolean;
}): string[] {
  const { support, functionChain } = args;
  if (!support.supportsMessagePathFunctions) {
    return [];
  }
  const item = structureAfterFunctionChain(args.terminatingItem, functionChain, {
    isTopic: args.isTopic,
  });
  const items: string[] = [];
  if (
    args.isTopic === true &&
    (functionChain?.length ?? 0) === 0 &&
    support.supportsTimeSeriesMessagePathFunctions
  ) {
    items.push("@timedelta");
  }
  if (item == undefined) {
    return items;
  }
  if (isNumericStructure(item)) {
    for (const name of SCALAR_FUNCTION_NAMES) {
      items.push(`@${name}`);
    }
    for (const name of OPERAND_FUNCTION_NAMES) {
      items.push(`@${name}(`);
    }
    if (
      support.supportsTimeSeriesMessagePathFunctions &&
      functionChain?.some(isTimeSeriesStep) !== true
    ) {
      for (const name of TIME_SERIES_FUNCTION_NAMES) {
        items.push(`@${name}`);
      }
    }
  } else if (item.structureType === "array") {
    for (const name of ARRAY_FUNCTION_NAMES) {
      items.push(`@${name}`);
    }
    if (isNumericPrimitive(item.next)) {
      for (const name of VECTOR_FUNCTION_NAMES) {
        items.push(`@${name}`);
      }
    }
  } else if (item.structureType === "message") {
    if (isVectorStructure(item)) {
      for (const name of VECTOR_FUNCTION_NAMES) {
        items.push(`@${name}`);
      }
    }
    if (hasNumericFields(item, ["x", "y", "z", "w"])) {
      for (const name of ["rpy", "ypr", "yrp"] as const) {
        for (const field of STRUCT_FIELD_ACCESS[name] ?? []) {
          items.push(`@${name}.${field}`);
        }
      }
    }
    if (hasNumericFields(item, ["roll", "pitch", "yaw"])) {
      for (const field of STRUCT_FIELD_ACCESS.quat ?? []) {
        items.push(`@quat.${field}`);
      }
    }
  }

  return [...new Set(items)];
}

export function validateMessagePathInput(
  path: string,
  support: MessagePathFunctionSupport,
  terminatingItem?: MessagePathStructureItem,
): string | undefined {
  if (path.trim().length === 0) {
    return undefined;
  }

  const { path: parsed, diagnostics } = parseMessagePathWithDiagnostics(path);
  if (parsed == undefined) {
    return diagnostics.some((item) => item.code === "unclosed_paren")
      ? "Incomplete expression"
      : "Invalid expression";
  }
  if (parsed.functionChain != undefined && !support.supportsMessagePathFunctions) {
    return "This field does not accept functions";
  }
  if (!parsed.isFullySpecified) {
    return "Incomplete expression";
  }
  return validateMessagePathFunctions(parsed, support, terminatingItem);
}
