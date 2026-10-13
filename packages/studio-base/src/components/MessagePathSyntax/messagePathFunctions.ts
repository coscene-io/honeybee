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

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "bigint" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function coerceToNumber(value: unknown): number | undefined {
  switch (typeof value) {
    case "number":
      return value;
    case "bigint":
      return Number(value);
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
    // hypot(hypot(a, b), c) === hypot(a, b, c): folding avoids both the argument-count limit of
    // a spread call and the overflow of a plain sum of squares.
    let norm = 0;
    for (const item of value) {
      const n = asFiniteNumber(item);
      if (n == undefined) {
        return undefined;
      }
      norm = Math.hypot(norm, n);
    }
    return norm;
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
    roll: normalizeZero(tmpEuler.x),
    pitch: normalizeZero(tmpEuler.y),
    yaw: normalizeZero(tmpEuler.z),
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
  // Foxglove 3.1.1 converts roll/pitch/yaw using the ZYX rotation order.
  tmpEuler.set(roll, pitch, yaw, "ZYX");
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
  if (allowed?.includes(fieldAccess) !== true) {
    return undefined;
  }
  return result[fieldAccess];
}

/**
 * Apply every step of `functionChain` to `value`, left to right. Returns `undefined` when any step
 * cannot be applied. Time-series steps are not per-sample operations: the Plot timestamp builder
 * strips them before calling this (see `splitTimeSeriesFunctionChain`), every other caller gets
 * `undefined` so an unsupported path shows no data instead of the untransformed value.
 */
export function applyFunctionChain(
  value: unknown,
  functionChain: readonly MessagePathFunction[] | undefined,
): unknown {
  let current: unknown = value;
  for (const step of functionChain ?? []) {
    const name = parseFunction(step.function)?.name;
    if (
      name == undefined ||
      validateFunctionStep(step, {}) != undefined ||
      TIME_SERIES_FUNCTION_NAMES.includes(name)
    ) {
      return undefined;
    }

    if (ARRAY_FUNCTION_NAMES.includes(name)) {
      current = applyLength(current);
    } else if (VECTOR_FUNCTION_NAMES.includes(name)) {
      current = applyNorm(current);
    } else if (STRUCT_FUNCTION_NAMES.has(name)) {
      current = applyStruct(name, current, step.fieldAccess);
    } else {
      const fn = compileScalarFunction(step.function);
      const n = coerceToNumber(current);
      current = fn != undefined && n != undefined ? fn(n) : undefined;
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
    const globalValue = globalVariables[raw.slice(1)];
    if (typeof globalValue === "number" && Number.isFinite(globalValue)) {
      return undefined;
    }
    return `"${raw}" is not a numeric global`;
  }
  return "Operand function requires a finite number or $variable";
}

const NUMERIC_PRIMITIVE: MessagePathStructureItem = {
  structureType: "primitive",
  primitiveType: "float64",
  datatype: "float64",
};

export function isNumericPrimitive(item: MessagePathStructureItem | undefined): boolean {
  return (
    item?.structureType === "primitive" &&
    item.primitiveType !== "string" &&
    item.primitiveType !== "bool"
  );
}

/** Numeric primitive, or a Time-shaped message (coerced with `toSec` at evaluation time). */
export function isNumericStructure(item: MessagePathStructureItem | undefined): boolean {
  return (
    isNumericPrimitive(item) ||
    (item?.structureType === "message" &&
      Object.keys(item.nextByName).length === 2 &&
      ["sec", "nsec"].every((name) => {
        const field = item.nextByName[name];
        return (
          field?.structureType === "primitive" &&
          field.primitiveType !== "string" &&
          field.primitiveType !== "bool" &&
          field.primitiveType !== "int64" &&
          field.primitiveType !== "uint64"
        );
      }))
  );
}

export function hasNumericFields(
  item: MessagePathStructureItem | undefined,
  names: readonly string[],
): boolean {
  return (
    item?.structureType === "message" &&
    names.every((name) => isNumericPrimitive(item.nextByName[name]))
  );
}

/** `{x, y}` or `{x, y, z}` with numeric coordinates; mirrors what `applyNorm` accepts. */
export function isVectorStructure(item: MessagePathStructureItem | undefined): boolean {
  if (item?.structureType !== "message" || !hasNumericFields(item, ["x", "y"])) {
    return false;
  }
  const z = item.nextByName.z;
  return z == undefined || isNumericPrimitive(z);
}

function structMessage(datatype: string, fields: readonly string[]): MessagePathStructureItem {
  return {
    structureType: "message",
    datatype,
    nextByName: Object.fromEntries(fields.map((field) => [field, NUMERIC_PRIMITIVE])),
  };
}

function describeStructure(item: MessagePathStructureItem): string {
  switch (item.structureType) {
    case "primitive":
      return `a ${item.primitiveType}`;
    case "array":
      return "an array";
    case "message":
      return item.datatype === "" ? "a message" : `a ${item.datatype}`;
  }
}

/**
 * Structure produced by applying one (syntactically valid) function step to `input`, or
 * `undefined` when the function cannot be applied to a value of that shape. This is the single
 * source of truth that keeps validation, autocomplete and `applyFunctionChain` in agreement.
 */
function structureAfterFunction(
  input: MessagePathStructureItem,
  name: string,
  fieldAccess: string | undefined,
  options: { isTopic: boolean },
): MessagePathStructureItem | undefined {
  if (name === "timedelta" && options.isTopic) {
    return NUMERIC_PRIMITIVE;
  }
  if (STRUCT_FUNCTION_NAMES.has(name)) {
    const required = name === "quat" ? ["roll", "pitch", "yaw"] : ["x", "y", "z", "w"];
    if (!hasNumericFields(input, required)) {
      return undefined;
    }
    return fieldAccess != undefined
      ? NUMERIC_PRIMITIVE
      : structMessage(name, STRUCT_FIELD_ACCESS[name]!);
  }
  if (ARRAY_FUNCTION_NAMES.includes(name)) {
    return input.structureType === "array" ? NUMERIC_PRIMITIVE : undefined;
  }
  if (VECTOR_FUNCTION_NAMES.includes(name)) {
    const ok =
      input.structureType === "array" ? isNumericPrimitive(input.next) : isVectorStructure(input);
    return ok ? NUMERIC_PRIMITIVE : undefined;
  }
  // scalar, operand and time-series functions
  return isNumericStructure(input) ? NUMERIC_PRIMITIVE : undefined;
}

/**
 * Structure of the value produced by `functionChain` applied to `item`, or `undefined` when the
 * input is unknown or some step cannot be applied.
 */
export function structureAfterFunctionChain(
  item: MessagePathStructureItem | undefined,
  functionChain: readonly MessagePathFunction[] | undefined,
  options: { isTopic?: boolean } = {},
): MessagePathStructureItem | undefined {
  let current = item;
  let currentIsTopic = options.isTopic === true;
  for (const step of functionChain ?? []) {
    const name = parseFunction(step.function)?.name;
    if (current == undefined || name == undefined || !CATALOG_FUNCTION_NAMES.has(name)) {
      return undefined;
    }
    current = structureAfterFunction(current, name, step.fieldAccess, { isTopic: currentIsTopic });
    currentIsTopic = false;
  }
  return current;
}

function validateFunctionStep(
  step: MessagePathFunction,
  globalVariables: Record<string, unknown>,
): string | undefined {
  const parsedFn = parseFunction(step.function);
  if (parsedFn == undefined) {
    return `"${step.function}" is not a valid function`;
  }

  const { name, operand, operandRaw } = parsedFn;
  if (!CATALOG_FUNCTION_NAMES.has(name)) {
    return `"${name}" is not a valid function`;
  }

  if (OPERAND_FUNCTION_NAMES.includes(name)) {
    const operandErr = validateOperand(operand, operandRaw, globalVariables);
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
    if (STRUCT_FIELD_ACCESS[name]?.includes(step.fieldAccess) !== true) {
      return `"${step.fieldAccess}" is not a valid field for ${name}`;
    }
  }

  return undefined;
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
  if (!support.supportsMessagePathFunctions) {
    return "This field does not accept functions";
  }

  let current = terminatingItem;
  let seenTimeSeries = false;
  let isTopic = parsed.messagePath.every((part) => part.type === "filter");
  for (const step of chain) {
    const stepError = validateFunctionStep(step, support.globalVariables);
    if (stepError != undefined) {
      return stepError;
    }
    const name = parseFunction(step.function)!.name;

    if (TIME_SERIES_FUNCTION_NAMES.includes(name)) {
      if (!support.supportsTimeSeriesMessagePathFunctions) {
        return "This field does not accept time-series functions";
      }
      if (seenTimeSeries) {
        return "Only one time-series function is allowed per path";
      }
      seenTimeSeries = true;
    } else if (
      seenTimeSeries &&
      !SCALAR_FUNCTION_NAMES.includes(name) &&
      !OPERAND_FUNCTION_NAMES.includes(name)
    ) {
      // Redundant with the type check below once the structure is known; still needed when the
      // caller has no schema (panel settings validation).
      return "Only scalar or operand functions are allowed after a time-series function";
    }

    // Type-check against the output of the previous step when the schema is known.
    if (current != undefined) {
      const next = structureAfterFunction(current, name, step.fieldAccess, { isTopic });
      if (next == undefined) {
        return `"${name}" cannot be applied to ${describeStructure(current)}`;
      }
      current = next;
    }
    isTopic = false;
  }

  return undefined;
}
