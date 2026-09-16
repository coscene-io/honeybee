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
} from "@foxglove/studio-base/components/MessagePathSyntax/messagePathFunctions";

export type TimeSeriesName = "delta" | "derivative" | "timedelta";

export function splitTimeSeriesFunctionChain(path: MessagePath): {
  pathBeforeSpecialFunction: MessagePath;
  specialFunction: TimeSeriesName | undefined;
  postSpecialScalarFunctions: Array<(n: number) => number>;
} {
  const chain = path.functionChain ?? [];
  let specialIndex = -1;
  let specialFunction: TimeSeriesName | undefined;
  for (let index = 0; index < chain.length; index++) {
    const parsed = parseFunction(chain[index]!.function);
    if (parsed != undefined && isTimeSeriesName(parsed.name)) {
      specialIndex = index;
      specialFunction = parsed.name;
      break;
    }
  }

  if (specialIndex < 0 || specialFunction == undefined) {
    return {
      pathBeforeSpecialFunction: path,
      specialFunction: undefined,
      postSpecialScalarFunctions: [],
    };
  }

  const before = chain.slice(0, specialIndex);
  const postSpecialScalarFunctions: Array<(n: number) => number> = [];
  for (const step of chain.slice(specialIndex + 1)) {
    const fn = compileScalarFunction(step.function);
    if (fn) {
      postSpecialScalarFunctions.push(fn);
    }
  }

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
