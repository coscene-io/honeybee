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

import {
  compileScalarFunction,
  validateMessagePathFunctions,
} from "./messagePathFunctions";

const plotSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: true,
  globalVariables: {},
};

const gaugeSupport = {
  ...plotSupport,
  supportsTimeSeriesMessagePathFunctions: false,
};

describe("compileScalarFunction", () => {
  it("maps 3.1.1 names", () => {
    expect(compileScalarFunction("abs")!(-3)).toBe(3);
    expect(compileScalarFunction("degrees")!(Math.PI)).toBeCloseTo(180);
    expect(compileScalarFunction("radians")!(180)).toBeCloseTo(Math.PI);
    expect(compileScalarFunction("mul(3.6)")!(10)).toBeCloseTo(36);
    expect(compileScalarFunction("negative")!(4)).toBe(-4);
  });

  it("does not compile deg2rad/rad2deg", () => {
    expect(compileScalarFunction("deg2rad")).toBeUndefined();
    expect(compileScalarFunction("rad2deg")).toBeUndefined();
  });
});

describe("validateMessagePathFunctions", () => {
  it("rejects functions when the field disables them", () => {
    const parsed = parseMessagePath("/t.v.@abs")!;
    expect(
      validateMessagePathFunctions(parsed, {
        supportsMessagePathFunctions: false,
        supportsTimeSeriesMessagePathFunctions: false,
        globalVariables: {},
      }),
    ).toMatch(/does not accept functions/i);
  });

  it("rejects time-series on gauge", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative")!, gaugeSupport),
    ).toMatch(/time-series/i);
  });

  it("rejects unknown names including deg2rad", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@deg2rad")!, plotSupport),
    ).toMatch(/not a valid function/i);
  });

  it("rejects operand-less mul and extra operand on abs", () => {
    expect(validateMessagePathFunctions(parseMessagePath("/t.v.@mul")!, plotSupport)).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@abs(1)")!, plotSupport),
    ).toBeDefined();
  });

  it("rejects a second time-series or @derivative.@norm", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@derivative")!, plotSupport),
    ).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@norm")!, plotSupport),
    ).toBeDefined();
  });

  it("allows @derivative.@abs on plot", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@abs")!, plotSupport),
    ).toBeUndefined();
  });

  it("rejects field access on non-struct functions and bad struct fields", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@abs.yaw")!, plotSupport),
    ).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@rpy.w")!, plotSupport),
    ).toBeDefined();
  });

  it("requires $operand to be a numeric global", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@mul($scale)")!, {
        ...plotSupport,
        globalVariables: { scale: "nope" },
      }),
    ).toMatch(/not a numeric global/i);
  });

  it("rejects @length when the terminating value is not an array", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@length")!, plotSupport, {
        structureType: "primitive",
        primitiveType: "float64",
        datatype: "float64",
      }),
    ).toMatch(/array/i);
  });
});
