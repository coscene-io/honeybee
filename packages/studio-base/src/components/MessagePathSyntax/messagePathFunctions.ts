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

import { Euler, Quaternion } from "three";

import {
  MessagePath,
  MessagePathFunction,
  MessagePathStructureItem,
  parseFunction,
  STRUCT_FUNCTION_NAMES,
} from "@foxglove/message-path";
import { isTime, toSec } from "@foxglove/rostime";
import { isTypedArray } from "@foxglove/studio-base/types/isTypedArray";

export const SCALAR_FUNCTION_NAMES: readonly string[] = [
  "abs",
  "acos",
  "asin",
  "atan",
  "ceil",
  "cos",
  "log",
  "log1p",
  "log2",
  "log10",
  "round",
  "sign",
  "sin",
  "sqrt",
  "tan",
  "trunc",
  "negative",
  "radians",
  "degrees",
];

export const OPERAND_FUNCTION_NAMES: readonly string[] = ["add", "sub", "mul", "div"];

export const ARRAY_FUNCTION_NAMES: readonly string[] = ["length"];

export const VECTOR_FUNCTION_NAMES: readonly string[] = ["norm"];

export const TIME_SERIES_FUNCTION_NAMES: readonly string[] = ["delta", "derivative", "timedelta"];

export const STRUCT_FIELD_ACCESS: Record<string, readonly string[]> = {
  rpy: ["roll", "pitch", "yaw"],
  ypr: ["roll", "pitch", "yaw"],
  yrp: ["roll", "pitch", "yaw"],
  quat: ["x", "y", "z", "w"],
};

export type MessagePathFunctionSupport = {
  supportsMessagePathFunctions: boolean;
  supportsTimeSeriesMessagePathFunctions: boolean;
  globalVariables: Record<string, unknown>;
};

const CATALOG_FUNCTION_NAMES = new Set<string>([
  ...SCALAR_FUNCTION_NAMES,
  ...OPERAND_FUNCTION_NAMES,
  ...ARRAY_FUNCTION_NAMES,
  ...VECTOR_FUNCTION_NAMES,
  ...TIME_SERIES_FUNCTION_NAMES,
  ...STRUCT_FUNCTION_NAMES,
]);

const SCALAR_BY_NAME: Record<string, (n: number) => number> = {
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  ceil: Math.ceil,
  cos: Math.cos,
  log: Math.log,
  log1p: Math.log1p,
  log2: Math.log2,
  log10: Math.log10,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
  trunc: Math.trunc,
  negative: (n) => -n,
  radians: (n) => (n * Math.PI) / 180,
  degrees: (n) => (n * 180) / Math.PI,
};

export function compileScalarFunction(functionStr: string): ((n: number) => number) | undefined {
  const parsed = parseFunction(functionStr);
  if (parsed == undefined) {
    return undefined;
  }

  const { name, operand, operandRaw } = parsed;
  if (OPERAND_FUNCTION_NAMES.includes(name)) {
    if (operand == undefined || !Number.isFinite(operand)) {
      return undefined;
    }
    switch (name) {
      case "add":
        return (n) => n + operand;
      case "sub":
        return (n) => n - operand;
      case "mul":
        return (n) => n * operand;
      case "div":
        return (n) => n / operand;
      default:
        return undefined;
    }
  }

  if (operandRaw != undefined) {
    return undefined;
  }
  return SCALAR_BY_NAME[name];
}

const tmpQuaternion = new Quaternion();
const tmpEuler = new Euler();

const STRUCT_EULER_ORDER: Record<string, "XYZ" | "ZYX" | "ZXY"> = {
  rpy: "XYZ",
  ypr: "ZYX",
  yrp: "ZXY",
};

function wrapToPi(rad: number): number {
  // three.js can return an equivalent wrap (e.g. -3π/2 instead of π/2); match Foxglove XYZ.
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function coerceToNumber(value: unknown): number | undefined {
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "bigint":
    case "boolean":
    case "string": {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    default:
      if (isTime(value)) {
        return toSec(value);
      }
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value != undefined && !Array.isArray(value) && !isTypedArray(value)
  );
}

function applyLength(value: unknown): number | undefined {
  if (Array.isArray(value) || isTypedArray(value)) {
    return value.length;
  }
  return undefined;
}

function applyNorm(value: unknown): number | undefined {
  if (Array.isArray(value) || isTypedArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    const nums: number[] = [];
    for (let i = 0; i < value.length; i++) {
      const n = Number(value[i]);
      if (!Number.isFinite(n)) {
        return undefined;
      }
      nums.push(n);
    }
    return Math.hypot(...nums);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const x = asFiniteNumber(value.x);
  const y = asFiniteNumber(value.y);
  if (x == undefined || y == undefined) {
    return undefined;
  }
  if (value.z == undefined) {
    return Math.hypot(x, y);
  }
  const z = asFiniteNumber(value.z);
  if (z == undefined) {
    return undefined;
  }
  return Math.hypot(x, y, z);
}

function quatToRpy(
  value: unknown,
  order: "XYZ" | "ZYX" | "ZXY",
): { roll: number; pitch: number; yaw: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const x = asFiniteNumber(value.x);
  const y = asFiniteNumber(value.y);
  const z = asFiniteNumber(value.z);
  const w = asFiniteNumber(value.w);
  if (x == undefined || y == undefined || z == undefined || w == undefined) {
    return undefined;
  }
  tmpQuaternion.set(x, y, z, w);
  tmpEuler.setFromQuaternion(tmpQuaternion, order);
  return {
    roll: wrapToPi(tmpEuler.x),
    pitch: wrapToPi(tmpEuler.y),
    yaw: wrapToPi(tmpEuler.z),
  };
}

function rpyToQuat(value: unknown): { x: number; y: number; z: number; w: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const roll = asFiniteNumber(value.roll);
  const pitch = asFiniteNumber(value.pitch);
  const yaw = asFiniteNumber(value.yaw);
  if (roll == undefined || pitch == undefined || yaw == undefined) {
    return undefined;
  }
  tmpEuler.set(roll, pitch, yaw, "XYZ");
  tmpQuaternion.setFromEuler(tmpEuler);
  return { x: tmpQuaternion.x, y: tmpQuaternion.y, z: tmpQuaternion.z, w: tmpQuaternion.w };
}

function applyStruct(name: string, value: unknown, fieldAccess: string | undefined): unknown {
  let result: Record<string, number> | undefined;
  if (name === "quat") {
    result = rpyToQuat(value);
  } else {
    const order = STRUCT_EULER_ORDER[name];
    if (order == undefined) {
      return undefined;
    }
    result = quatToRpy(value, order);
  }
  if (result == undefined) {
    return undefined;
  }
  if (fieldAccess == undefined) {
    return result;
  }
  const allowed = STRUCT_FIELD_ACCESS[name];
  if (allowed == undefined || !allowed.includes(fieldAccess)) {
    return undefined;
  }
  return (result as Record<string, number>)[fieldAccess];
}

function applyScalar(value: unknown, fn: (n: number) => number): unknown {
  const n = coerceToNumber(value);
  if (n != undefined) {
    return fn(n);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    out[key] = typeof field === "number" && Number.isFinite(field) ? fn(field) : field;
  }
  return out;
}

export function applyFunctionChain(
  value: unknown,
  functionChain: MessagePathFunction[] | undefined,
): unknown {
  let current: unknown = value;
  for (const step of functionChain ?? []) {
    const parsed = parseFunction(step.function);
    if (parsed == undefined) {
      continue;
    }
    const { name } = parsed;
    if (TIME_SERIES_FUNCTION_NAMES.includes(name) || !CATALOG_FUNCTION_NAMES.has(name)) {
      continue;
    }

    if (ARRAY_FUNCTION_NAMES.includes(name)) {
      current = applyLength(current);
    } else if (VECTOR_FUNCTION_NAMES.includes(name)) {
      current = applyNorm(current);
    } else if (STRUCT_FUNCTION_NAMES.has(name)) {
      current = applyStruct(name, current, step.fieldAccess);
    } else {
      const fn = compileScalarFunction(step.function);
      if (fn == undefined) {
        return undefined;
      }
      current = applyScalar(current, fn);
    }

    if (current == undefined) {
      return undefined;
    }
  }
  return current;
}

function validateOperand(
  operand: number | undefined,
  operandRaw: string | undefined,
  globalVariables: Record<string, unknown>,
): string | undefined {
  if (operand != undefined && Number.isFinite(operand)) {
    return undefined;
  }
  const raw = operandRaw?.trim();
  if (raw?.startsWith("$") === true) {
    if (typeof globalVariables[raw.slice(1)] === "number") {
      return undefined;
    }
    return `"${raw}" is not a numeric global`;
  }
  return "Operand function requires a finite number or $variable";
}

export function validateMessagePathFunctions(
  parsed: MessagePath,
  support: MessagePathFunctionSupport,
  terminatingItem?: MessagePathStructureItem,
): string | undefined {
  const chain = parsed.functionChain;
  if (chain == undefined || chain.length === 0) {
    return undefined;
  }
  if (support.supportsMessagePathFunctions !== true) {
    return "This field does not accept functions";
  }

  let seenTimeSeries = false;
  for (const step of chain) {
    const parsedFn = parseFunction(step.function);
    if (parsedFn == undefined) {
      return `"${step.function}" is not a valid function`;
    }

    const { name, operand, operandRaw } = parsedFn;
    if (!CATALOG_FUNCTION_NAMES.has(name)) {
      return `"${name}" is not a valid function`;
    }

    if (OPERAND_FUNCTION_NAMES.includes(name)) {
      const operandErr = validateOperand(operand, operandRaw, support.globalVariables);
      if (operandErr != undefined) {
        return operandErr;
      }
    } else if (operandRaw != undefined) {
      return `"${name}" does not take an operand`;
    }

    if (step.fieldAccess != undefined) {
      if (!STRUCT_FUNCTION_NAMES.has(name)) {
        return `"${name}" does not support field access`;
      }
      const allowed = STRUCT_FIELD_ACCESS[name];
      if (allowed == undefined || !allowed.includes(step.fieldAccess)) {
        return `"${step.fieldAccess}" is not a valid field for ${name}`;
      }
    }

    if (
      ARRAY_FUNCTION_NAMES.includes(name) &&
      terminatingItem != undefined &&
      terminatingItem.structureType !== "array"
    ) {
      return `"${name}" can only be applied to an array`;
    }

    if (TIME_SERIES_FUNCTION_NAMES.includes(name)) {
      if (support.supportsTimeSeriesMessagePathFunctions === false) {
        return "This field does not accept time-series functions";
      }
      if (seenTimeSeries) {
        return "Only one time-series function is allowed per path";
      }
      seenTimeSeries = true;
    } else if (
      seenTimeSeries &&
      compileScalarFunction(step.function) == undefined &&
      !OPERAND_FUNCTION_NAMES.includes(name)
    ) {
      return "Only scalar or operand functions are allowed after a time-series function";
    }
  }

  return undefined;
}
