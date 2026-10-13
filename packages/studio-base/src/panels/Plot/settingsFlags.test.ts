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

import { parseMessagePath } from "@foxglove/message-path";
import { validateMessagePathFunctions } from "@foxglove/studio-base/components/MessagePathSyntax/messagePathFunctions";
import { validateSimpleMessagePath } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { plotPathFunctionError } from "@foxglove/studio-base/panels/Plot/settings";
import { stateTransitionPathFunctionError } from "@foxglove/studio-base/panels/StateTransitions/settings";

describe("panel FoxQL flags", () => {
  const plot = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: true,
    globalVariables: {},
  };
  const gauge = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: false,
    globalVariables: {},
  };

  it("plot timestamp x-axis allows @derivative; index/custom do not", () => {
    const parsed = parseMessagePath("/t.v.@derivative")!;
    expect(validateMessagePathFunctions(parsed, plot)).toBeUndefined();
    expect(validateMessagePathFunctions(parsed, gauge)).toBeDefined();
    expect(plotPathFunctionError("/t.v.@derivative", "timestamp", {})).toBeUndefined();
    expect(plotPathFunctionError("/t.v.@delta", "timestamp", {})).toBeUndefined();
    expect(plotPathFunctionError("/t.v.@timedelta", "timestamp", {})).toBeUndefined();
    expect(plotPathFunctionError("/t.v.@derivative", "index", {})).toBe(
      "This field does not accept time-series functions",
    );
    expect(plotPathFunctionError("/t.v.@derivative", "custom", {})).toBe(
      "This field does not accept time-series functions",
    );
    expect(plotPathFunctionError("/t.v.@derivative", "currentCustom", {})).toBe(
      "This field does not accept time-series functions",
    );
  });

  it("gauge and indicator treat $ variables anywhere in the path as unsupported", () => {
    const unsupported = "Message paths using variables are not currently supported";
    expect(validateSimpleMessagePath(parseMessagePath("/t.v.@mul($scale)"))).toBe(unsupported);
    expect(validateSimpleMessagePath(parseMessagePath("/t.arr[$i]"))).toBe(unsupported);
    expect(validateSimpleMessagePath(parseMessagePath("/t.arr[:]{id==$id}.v"))).toBe(unsupported);
    expect(validateSimpleMessagePath(parseMessagePath("/t.v.@mul(2)"))).toBeUndefined();
    expect(validateSimpleMessagePath(parseMessagePath("/t.v.@derivative"))).toBe(
      "This field does not accept time-series functions",
    );
    expect(validateSimpleMessagePath(parseMessagePath("/t.v.@"))).toBeUndefined();
    expect(validateSimpleMessagePath(undefined)).toBeUndefined();
  });

  it("state transitions accepts numeric $scale globals", () => {
    expect(stateTransitionPathFunctionError("/t.v.@mul($scale)", { scale: 2 })).toBeUndefined();
    expect(stateTransitionPathFunctionError("/t.v.@mul($scale)", {})).toMatch(
      /not a numeric global/i,
    );
  });
});

it.each(["/t.v.@mul(", "/t.v.@mul(3.6", "/t.v.@"])("reports incomplete Plot input %s", (path) => {
  expect(plotPathFunctionError(path, "timestamp", {})).toBe("Incomplete expression");
});
