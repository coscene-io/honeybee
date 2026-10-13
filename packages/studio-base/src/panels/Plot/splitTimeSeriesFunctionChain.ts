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

import { MessagePath, parseFunction } from "@foxglove/message-path";
import {
  compileScalarFunction,
  TIME_SERIES_FUNCTION_NAMES,
  validateMessagePathFunctions,
} from "@foxglove/studio-base/components/MessagePathSyntax/messagePathFunctions";

export type TimeSeriesName = "delta" | "derivative" | "timedelta";

export type TimeSeriesSplit = {
  /** Path (and function steps) evaluated per message before the time-series step. */
  pathBeforeSpecialFunction: MessagePath;
  specialFunction: TimeSeriesName | undefined;
  /** Scalar/operand steps applied to the time-series result. */
  postSpecialScalarFunctions: Array<(n: number) => number>;
};

/**
 * Split a Plot timestamp series path around its time-series function. Returns `undefined` when
 * a step after the time-series function is not a scalar/operand function (e.g. a second
 * `@derivative`), so the series is dropped rather than plotted with part of its chain ignored.
 */
export function splitTimeSeriesFunctionChain(path: MessagePath): TimeSeriesSplit | undefined {
  if (
    !path.isFullySpecified ||
    validateMessagePathFunctions(path, {
      supportsMessagePathFunctions: true,
      supportsTimeSeriesMessagePathFunctions: true,
      globalVariables: {},
    }) != undefined
  ) {
    return undefined;
  }
  const chain = path.functionChain ?? [];
  let specialIndex = -1;
  let specialFunction: TimeSeriesName | undefined;
  for (const [index, step] of chain.entries()) {
    const name = parseFunction(step.function)?.name;
    if (name != undefined && isTimeSeriesName(name)) {
      specialIndex = index;
      specialFunction = name;
      break;
    }
  }
  if (specialFunction == undefined) {
    return { pathBeforeSpecialFunction: path, specialFunction, postSpecialScalarFunctions: [] };
  }

  const postSpecialScalarFunctions: Array<(n: number) => number> = [];
  for (const step of chain.slice(specialIndex + 1)) {
    const fn = compileScalarFunction(step.function);
    if (fn == undefined) {
      return undefined;
    }
    postSpecialScalarFunctions.push(fn);
  }

  const before = chain.slice(0, specialIndex);
  return {
    pathBeforeSpecialFunction: {
      ...path,
      functionChain: before.length > 0 ? before : undefined,
    },
    specialFunction,
    postSpecialScalarFunctions,
  };
}

function isTimeSeriesName(name: string): name is TimeSeriesName {
  return TIME_SERIES_FUNCTION_NAMES.includes(name);
}
