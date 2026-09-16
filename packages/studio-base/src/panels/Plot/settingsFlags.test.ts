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
import { gaugePathParseError } from "@foxglove/studio-base/panels/Gauge/settings";
import { indicatorPathParseError } from "@foxglove/studio-base/panels/Indicator/settings";
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

  it("gauge and indicator treat $ function operands as unsupported variables", () => {
    const parsed = parseMessagePath("/t.v.@mul($scale)")!;
    expect(gaugePathParseError(parsed)).toBe(
      "Message paths using variables are not currently supported",
    );
    expect(indicatorPathParseError(parsed)).toBe(
      "Message paths using variables are not currently supported",
    );
    expect(gaugePathParseError(parseMessagePath("/t.v.@mul(2)"))).toBeUndefined();
  });

  it("state transitions accepts numeric $scale globals", () => {
    expect(stateTransitionPathFunctionError("/t.v.@mul($scale)", { scale: 2 })).toBeUndefined();
    expect(stateTransitionPathFunctionError("/t.v.@mul($scale)", {})).toMatch(
      /not a numeric global/i,
    );
  });
});
