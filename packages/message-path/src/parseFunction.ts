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

export const STRUCT_FUNCTION_NAMES: ReadonlySet<string> = new Set(["rpy", "quat", "ypr", "yrp"]);

const FUNCTION_RE = /^([a-zA-Z0-9_-]+)(?:\((.*)\))?$/;

export type ParsedFunction = {
  name: string;
  operand?: number;
  operandRaw?: string;
};

export function parseFunction(functionStr: string): ParsedFunction | undefined {
  if (functionStr.length === 0) {
    return undefined;
  }
  const match = FUNCTION_RE.exec(functionStr);
  if (!match) {
    return { name: functionStr };
  }
  const name = match[1] ?? "";
  if (!name) {
    return undefined;
  }
  const raw = match[2]?.trim() ?? "";
  if (raw.length === 0) {
    return { name };
  }
  const unquoted = /^"(.*)"$|^'(.*)'$/s.exec(raw);
  const operandRaw = unquoted?.[1] ?? unquoted?.[2] ?? raw;
  // `Number("")` and `Number("  ")` are 0; an empty operand is not a number.
  const asNumber = operandRaw.trim().length === 0 ? NaN : Number(operandRaw);
  if (Number.isNaN(asNumber)) {
    return { name, operandRaw };
  }
  return { name, operand: asNumber, operandRaw };
}
