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

import { MessagePath, MessagePathFilter, MessagePathPart } from "./types";

type SlicePart = number | { variableName: string; startLoc: number };

type Slice = {
  start: SlicePart;
  end: SlicePart;
};

export function stringifyMessagePath(path: MessagePath): string {
  return (
    path.topicNameRepr +
    path.messagePath.map(stringifyPart).join("") +
    (path.functionChain ?? [])
      .map(
        (step) =>
          `.@${step.function}${step.fieldAccess != undefined ? `.${step.fieldAccess}` : ""}`,
      )
      .join("")
  );
}

function stringifyPart(part: MessagePathPart): string {
  switch (part.type) {
    case "name":
      return `.${part.repr}`;
    case "filter":
      return stringifyFilter(part);
    case "slice":
      return stringifySlice(part);
  }
}

function stringifySlice(slice: Slice): string {
  if (typeof slice.start === "number" && typeof slice.end === "number") {
    if (slice.start === slice.end) {
      return `[${slice.start}]`;
    }
    if (slice.start === 0) {
      return `[:${slice.end === Infinity ? "" : slice.end}]`;
    }
    return `[${slice.start === Infinity ? "" : slice.start}:${
      slice.end === Infinity ? "" : slice.end
    }]`;
  }

  const startStr = stringifySlicePart(slice.start);
  const endStr = stringifySlicePart(slice.end);
  if (startStr === endStr) {
    return `[${startStr}]`;
  }

  return `[${startStr}:${endStr}]`;
}

function stringifySlicePart(slicePart: SlicePart): string {
  if (typeof slicePart === "number") {
    if (slicePart === Infinity) {
      return "";
    }
    return String(slicePart);
  }

  return `$${slicePart.variableName}`;
}

function stringifyFilter(filter: MessagePathFilter): string {
  // `repr` is the user's text and is reused verbatim. After a `$var` has been filled in, `repr`
  // still names the variable, so the filter is rebuilt from the substituted value; callers use
  // the result as a series key that must change with the variable, not as parser input.
  if (typeof filter.value === "object" || !filter.repr.includes("$")) {
    return `{${filter.repr}}`;
  }

  const operator = filter.operator ?? "==";
  const valueStr =
    filter.valueIsIdentifier === true
      ? String(filter.value)
      : typeof filter.value === "bigint"
        ? filter.value.toString()
        : JSON.stringify(filter.value);
  return `{${filter.path.join(".")}${operator}${valueStr}}`;
}
