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

import { MessagePathStructureItem, parseMessagePath } from "@foxglove/message-path";

import {
  applyFunctionChain,
  compileScalarFunction,
  structureAfterFunctionChain,
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

const float64: MessagePathStructureItem = {
  structureType: "primitive",
  primitiveType: "float64",
  datatype: "float64",
};
const floatArray: MessagePathStructureItem = {
  structureType: "array",
  next: float64,
  datatype: "float64[]",
};
const quaternion: MessagePathStructureItem = {
  structureType: "message",
  datatype: "geometry_msgs/Quaternion",
  nextByName: { x: float64, y: float64, z: float64, w: float64 },
};
const vector2 = (x: MessagePathStructureItem): MessagePathStructureItem => ({
  structureType: "message",
  datatype: "Vector2",
  nextByName: { x, y: x },
});
const stamp: MessagePathStructureItem = {
  structureType: "message",
  datatype: "time",
  nextByName: {
    sec: { structureType: "primitive", primitiveType: "uint32", datatype: "" },
    nsec: { structureType: "primitive", primitiveType: "uint32", datatype: "" },
  },
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
    expect(validateMessagePathFunctions(parseMessagePath("/t.v.@deg2rad")!, plotSupport)).toMatch(
      /not a valid function/i,
    );
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

  it("rejects non-finite numeric globals as operands", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@mul($scale)")!, {
        ...plotSupport,
        globalVariables: { scale: Number.NaN },
      }),
    ).toMatch(/not a numeric global/i);
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@mul($scale)")!, {
        ...plotSupport,
        globalVariables: { scale: Number.POSITIVE_INFINITY },
      }),
    ).toMatch(/not a numeric global/i);
  });

  it("rejects whitespace-only and mismatched-quote operands", () => {
    expect(validateMessagePathFunctions(parseMessagePath("/t.v.@mul(   )")!, plotSupport)).toMatch(
      /requires a finite number/i,
    );
    expect(validateMessagePathFunctions(parseMessagePath(`/t.v.@mul("2')`)!, plotSupport)).toMatch(
      /requires a finite number/i,
    );
    expect(
      validateMessagePathFunctions(parseMessagePath(`/t.v.@mul("2")`)!, plotSupport),
    ).toBeUndefined();
  });

  describe("with a known terminating type", () => {
    it.each([
      { path: "/t.v.@length", item: float64, error: /"length" cannot be applied to a float64/ },
      { path: "/t.v.@norm", item: float64, error: /"norm" cannot be applied/ },
      { path: "/t.v.@rpy.yaw", item: float64, error: /"rpy" cannot be applied/ },
      { path: "/t.q.@quat.x", item: quaternion, error: /"quat" cannot be applied/ },
      { path: "/t.arr.@abs", item: floatArray, error: /"abs" cannot be applied to an array/ },
      { path: "/t.q.@abs", item: quaternion, error: /"abs" cannot be applied to a geometry_msgs/ },
      // the second step is checked against the first step's output
      { path: "/t.arr.@length.@length", item: floatArray, error: /"length" cannot be applied/ },
      { path: "/t.q.@rpy.@abs", item: quaternion, error: /"abs" cannot be applied to a rpy/ },
      { path: "/t.v.@derivative.@length", item: float64, error: /only scalar or operand/i },
    ])("rejects $path", ({ path, item, error }) => {
      expect(validateMessagePathFunctions(parseMessagePath(path)!, plotSupport, item)).toMatch(
        error,
      );
    });

    it.each([
      { path: "/t.arr.@length.@mul(2)", item: floatArray },
      { path: "/t.arr.@norm", item: floatArray },
      { path: "/t.q.@rpy.yaw.@degrees", item: quaternion },
      { path: "/t.q.@rpy", item: quaternion },
      { path: "/t.q.@rpy.@quat.w", item: quaternion },
      { path: "/t.stamp.@mul(1000).@derivative", item: stamp },
      { path: "/t.v.@norm", item: vector2(float64) },
    ])("accepts $path", ({ path, item }) => {
      expect(
        validateMessagePathFunctions(parseMessagePath(path)!, plotSupport, item),
      ).toBeUndefined();
    });
  });
});

describe("structureAfterFunctionChain", () => {
  it("returns the chain's output type", () => {
    expect(structureAfterFunctionChain(quaternion, [{ function: "rpy" }])).toMatchObject({
      structureType: "message",
      datatype: "rpy",
    });
    expect(
      structureAfterFunctionChain(quaternion, [{ function: "rpy", fieldAccess: "yaw" }]),
    ).toMatchObject({ structureType: "primitive" });
    expect(structureAfterFunctionChain(floatArray, [{ function: "length" }])).toMatchObject({
      structureType: "primitive",
    });
    expect(structureAfterFunctionChain(stamp, [{ function: "abs" }])).toMatchObject({
      structureType: "primitive",
    });
  });

  it("is the identity for an empty chain and undefined for an inapplicable step", () => {
    expect(structureAfterFunctionChain(quaternion, undefined)).toBe(quaternion);
    expect(structureAfterFunctionChain(undefined, [{ function: "abs" }])).toBeUndefined();
    expect(structureAfterFunctionChain(float64, [{ function: "length" }])).toBeUndefined();
    expect(structureAfterFunctionChain(float64, [{ function: "deg2rad" }])).toBeUndefined();
    expect(structureAfterFunctionChain(float64, [{ function: "" }])).toBeUndefined();
  });
});

const SQ2 = Math.SQRT1_2; // 90° yaw quaternion z/w

describe("applyFunctionChain", () => {
  it("applies scalar and operand", () => {
    expect(applyFunctionChain(-3, [{ function: "abs" }])).toBe(3);
    expect(applyFunctionChain(10, [{ function: "mul(3.6)" }])).toBeCloseTo(36);
  });

  it("computes length and norm", () => {
    expect(applyFunctionChain([1, 2, 3], [{ function: "length" }])).toBe(3);
    expect(applyFunctionChain({ x: 3, y: 4 }, [{ function: "norm" }])).toBe(5);
    expect(applyFunctionChain({ x: 0, y: 0, z: 1 }, [{ function: "norm" }])).toBe(1);
  });

  it("converts quaternion yaw to degrees", () => {
    expect(
      applyFunctionChain({ x: 0, y: 0, z: 0, w: 1 }, [
        { function: "rpy", fieldAccess: "yaw" },
        { function: "degrees" },
      ]),
    ).toBeCloseTo(0);
    expect(
      applyFunctionChain({ x: 0, y: 0, z: SQ2, w: SQ2 }, [
        { function: "rpy", fieldAccess: "yaw" },
        { function: "degrees" },
      ]),
    ).toBeCloseTo(90);
  });

  it("reads a Time value as seconds before math", () => {
    expect(
      applyFunctionChain({ sec: 1, nsec: 500_000_000 }, [{ function: "mul(1000)" }]),
    ).toBeCloseTo(1500);
  });

  it("drops the item for time-series, unknown and incomplete steps", () => {
    expect(applyFunctionChain(5, [{ function: "derivative" }])).toBeUndefined();
    expect(applyFunctionChain(5, [{ function: "delta" }, { function: "abs" }])).toBeUndefined();
    expect(applyFunctionChain(180, [{ function: "deg2rad" }])).toBeUndefined();
    expect(applyFunctionChain(180, [{ function: "" }])).toBeUndefined();
  });

  it("returns undefined when a step cannot apply to the value", () => {
    expect(applyFunctionChain(5, [{ function: "length" }])).toBeUndefined();
    expect(applyFunctionChain({ a: 1 }, [{ function: "norm" }])).toBeUndefined();
    expect(applyFunctionChain({ x: -1, y: 2 }, [{ function: "abs" }])).toBeUndefined();
    expect(applyFunctionChain([1, 2], [{ function: "abs" }])).toBeUndefined();
    expect(applyFunctionChain(5, [{ function: "rpy", fieldAccess: "yaw" }])).toBeUndefined();
  });

  it("accepts bigint coordinates and elements", () => {
    expect(applyFunctionChain({ x: 3n, y: 4n }, [{ function: "norm" }])).toBe(5);
    expect(applyFunctionChain(new BigInt64Array([3n, 4n]), [{ function: "norm" }])).toBe(5);
    expect(applyFunctionChain(7n, [{ function: "add(1)" }])).toBe(8);
  });

  it("computes the norm of a large array and of large values without overflow", () => {
    const big = new Float64Array(300_000).fill(1);
    expect(applyFunctionChain(big, [{ function: "norm" }])).toBeCloseTo(Math.sqrt(300_000));
    expect(applyFunctionChain([1e200, 1e200], [{ function: "norm" }])).toBe(
      Math.hypot(1e200, 1e200),
    );
  });

  it("requires z to be numeric when present, matching validation", () => {
    expect(applyFunctionChain({ x: 3, y: 4, z: "map" }, [{ function: "norm" }])).toBeUndefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@norm")!, plotSupport, {
        structureType: "message",
        datatype: "Named",
        nextByName: {
          x: float64,
          y: float64,
          z: { structureType: "primitive", primitiveType: "string", datatype: "string" },
        },
      }),
    ).toMatch(/"norm" cannot be applied/);
  });
});
