// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePathFilter } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";

export function filterMatches(filter: Immutable<MessagePathFilter>, value: unknown): boolean {
  if (typeof filter.value === "object") {
    throw new Error("filterMatches only works on paths where global variables have been filled in");
  }
  if (filter.value == undefined) {
    return false;
  }

  let currentValue = value;
  for (const name of filter.path) {
    if (typeof currentValue !== "object" || currentValue == undefined) {
      return false;
    }
    currentValue = (currentValue as Record<string, unknown>)[name];
    if (currentValue == undefined) {
      return false;
    }
  }

  if (currentValue == undefined) {
    return false;
  }

  const operator = filter.operator ?? "==";
  const rhs = filter.value;
  switch (operator) {
    case "==":
      // Test equality using `==` so we can be forgiving for comparing booleans with integers,
      // comparing numbers with strings, bigints with numbers, and so on.
      // eslint-disable-next-line @coscene-io/strict-equality
      return currentValue == rhs;
    case "!=":
      // eslint-disable-next-line @coscene-io/strict-equality
      return currentValue != rhs;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compareRelational(currentValue, rhs, operator);
  }
}

// Mixed BigInt vs boolean/string throws TypeError; treat as no match.
function compareRelational(
  left: unknown,
  right: string | number | bigint | boolean,
  operator: "<" | "<=" | ">" | ">=",
): boolean {
  try {
    switch (operator) {
      case "<":
        return (left as number) < (right as number);
      case "<=":
        return (left as number) <= (right as number);
      case ">":
        return (left as number) > (right as number);
      case ">=":
        return (left as number) >= (right as number);
    }
  } catch {
    return false;
  }
}
