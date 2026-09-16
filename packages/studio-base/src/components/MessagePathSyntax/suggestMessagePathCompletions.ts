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
  MessagePath,
  MessagePathFunction,
  MessagePathStructureItem,
  parseFunction,
  parseMessagePathWithDiagnostics,
  STRUCT_FUNCTION_NAMES,
} from "@foxglove/message-path";

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

const NUMERIC_PRIMITIVE: MessagePathStructureItem = {
  structureType: "primitive",
  primitiveType: "float64",
  datatype: "float64",
};

const RECOVERABLE_PARSE_CODES = new Set([
  "unclosed_paren",
  "empty_function",
  "empty_field_access",
  "unclosed_filter",
  "empty_name",
]);

function structureAfterFunctionChain(
  item: MessagePathStructureItem | undefined,
  functionChain: readonly MessagePathFunction[] | undefined,
): MessagePathStructureItem | undefined {
  if (item == undefined) {
    return undefined;
  }
  let current: MessagePathStructureItem = item;
  for (const step of functionChain ?? []) {
    const parsed = parseFunction(step.function);
    if (parsed == undefined || parsed.name === "") {
      break;
    }
    const { name } = parsed;
    if (STRUCT_FUNCTION_NAMES.has(name)) {
      if (step.fieldAccess != undefined && step.fieldAccess !== "") {
        current = NUMERIC_PRIMITIVE;
        continue;
      }
      if (name === "quat") {
        current = {
          structureType: "message",
          datatype: "quat",
          nextByName: {
            x: NUMERIC_PRIMITIVE,
            y: NUMERIC_PRIMITIVE,
            z: NUMERIC_PRIMITIVE,
            w: NUMERIC_PRIMITIVE,
          },
        };
      } else {
        current = {
          structureType: "message",
          datatype: name,
          nextByName: {
            roll: NUMERIC_PRIMITIVE,
            pitch: NUMERIC_PRIMITIVE,
            yaw: NUMERIC_PRIMITIVE,
          },
        };
      }
      continue;
    }
    if (
      ARRAY_FUNCTION_NAMES.includes(name) ||
      VECTOR_FUNCTION_NAMES.includes(name) ||
      SCALAR_FUNCTION_NAMES.includes(name) ||
      OPERAND_FUNCTION_NAMES.includes(name) ||
      TIME_SERIES_FUNCTION_NAMES.includes(name)
    ) {
      current = NUMERIC_PRIMITIVE;
    }
  }
  return current;
}

function appendTimeSeriesSuffixes(items: string[], support: MessagePathFunctionSupport): void {
  if (!support.supportsTimeSeriesMessagePathFunctions) {
    return;
  }
  for (const name of TIME_SERIES_FUNCTION_NAMES) {
    items.push(`@${name}`);
  }
}

export function suggestFunctionSuffixes(args: {
  terminatingItem: MessagePathStructureItem | undefined;
  support: MessagePathFunctionSupport;
  functionChain?: readonly MessagePathFunction[];
}): string[] {
  const terminatingItem = structureAfterFunctionChain(args.terminatingItem, args.functionChain);
  const { support } = args;
  if (!support.supportsMessagePathFunctions || terminatingItem == undefined) {
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
      if (isNumericPrimitive(terminatingItem.next)) {
        for (const name of VECTOR_FUNCTION_NAMES) {
          items.push(`@${name}`);
        }
      }
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
  terminatingItem?: MessagePathStructureItem,
): string | undefined {
  if (path.trim().length === 0) {
    return undefined;
  }
  if (!support.supportsMessagePathFunctions && path.includes(".@")) {
    return "This field does not accept functions";
  }

  const { path: parsed, diagnostics } = parseMessagePathWithDiagnostics(path);
  if (parsed == undefined) {
    const recoverable = diagnostics.some((item) => RECOVERABLE_PARSE_CODES.has(item.code));
    if (recoverable) {
      return undefined;
    }
    return "Invalid expression";
  }
  if (!parsed.isFullySpecified) {
    return "Incomplete expression";
  }
  if (parsed.functionChain == undefined || parsed.functionChain.length === 0) {
    return undefined;
  }
  return validateMessagePathFunctions(parsed, support, terminatingItem);
}

export function isCompleteFunctionPath(
  parsed: MessagePath,
  support: MessagePathFunctionSupport,
  terminatingItem?: MessagePathStructureItem,
): boolean {
  if (!parsed.isFullySpecified || (parsed.functionChain?.length ?? 0) === 0) {
    return false;
  }
  return validateMessagePathFunctions(parsed, support, terminatingItem) == undefined;
}
