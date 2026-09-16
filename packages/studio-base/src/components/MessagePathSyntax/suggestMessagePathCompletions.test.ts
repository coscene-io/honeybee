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
  isCompleteFunctionPath,
  suggestFunctionSuffixes,
  validateMessagePathInput,
} from "./suggestMessagePathCompletions";

const plotSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: true,
  globalVariables: {},
};

const floatItem = {
  structureType: "primitive" as const,
  primitiveType: "float64" as const,
  datatype: "float64",
};

describe("suggestFunctionSuffixes", () => {
  it("suggests scalar and operand on a number", () => {
    const items = suggestFunctionSuffixes({ terminatingItem: floatItem, support: plotSupport });
    expect(items).toEqual(expect.arrayContaining(["@abs", "@mul(", "@degrees", "@derivative"]));
  });

  it("omits time-series when disabled", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: floatItem,
      support: { ...plotSupport, supportsTimeSeriesMessagePathFunctions: false },
    });
    expect(items).not.toEqual(expect.arrayContaining(["@derivative"]));
    expect(items).toEqual(expect.arrayContaining(["@abs"]));
  });

  it("suggests length on arrays and norm on xyz", () => {
    const arrayItems = suggestFunctionSuffixes({
      terminatingItem: {
        structureType: "array",
        next: floatItem,
        datatype: "float64[]",
      },
      support: plotSupport,
    });
    expect(arrayItems).toEqual(expect.arrayContaining(["@length"]));
    expect(arrayItems).not.toEqual(expect.arrayContaining(["@abs", "@mul("]));
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "message",
          datatype: "Vector3",
          nextByName: {
            x: floatItem,
            y: floatItem,
            z: floatItem,
          },
        },
        support: plotSupport,
      }),
    ).toEqual(expect.arrayContaining(["@norm"]));
  });

  it("suggests scalars after a struct field conversion", () => {
    const quatItem = {
      structureType: "message" as const,
      datatype: "Quaternion",
      nextByName: {
        x: floatItem,
        y: floatItem,
        z: floatItem,
        w: floatItem,
      },
    };
    const items = suggestFunctionSuffixes({
      terminatingItem: quatItem,
      support: plotSupport,
      functionChain: [{ function: "rpy", fieldAccess: "yaw" }],
    });
    expect(items).toEqual(expect.arrayContaining(["@degrees", "@abs"]));
    expect(items).not.toEqual(expect.arrayContaining(["@rpy.yaw"]));
  });

  it("suggests rpy fields on a quaternion-shaped message", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: {
        structureType: "message",
        datatype: "Quaternion",
        nextByName: {
          x: floatItem,
          y: floatItem,
          z: floatItem,
          w: floatItem,
        },
      },
      support: plotSupport,
    });
    expect(items).toEqual(expect.arrayContaining(["@rpy.yaw", "@rpy.roll", "@rpy.pitch"]));
  });
});

describe("validateMessagePathInput", () => {
  it("errors when functions are disabled", () => {
    expect(
      validateMessagePathInput("/t.v.@abs", {
        supportsMessagePathFunctions: false,
        supportsTimeSeriesMessagePathFunctions: false,
        globalVariables: {},
      }),
    ).toBeDefined();
  });

  it.each([
    { path: "/t.v.@", expected: "Incomplete expression" },
    { path: "/t.v.@mul(", expected: undefined },
    { path: "/t.v.@abs#", expected: "Invalid expression" },
  ])("validateMessagePathInput($path)", ({ path, expected }) => {
    expect(validateMessagePathInput(path, plotSupport)).toBe(expected);
  });

  it("rejects @length on a scalar terminating type", () => {
    expect(validateMessagePathInput("/t.v.@length", plotSupport, floatItem)).toMatch(/array/i);
  });
});

describe("isCompleteFunctionPath", () => {
  it("treats converting functions as complete even when the field is not a primitive", () => {
    expect(isCompleteFunctionPath(parseMessagePath("/t.arr.@length")!, plotSupport)).toBe(true);
    expect(isCompleteFunctionPath(parseMessagePath("/t.q.@rpy.yaw")!, plotSupport)).toBe(true);
  });

  it("does not treat a path without a validating chain as complete", () => {
    expect(isCompleteFunctionPath(parseMessagePath("/t.q")!, plotSupport)).toBe(false);
    expect(isCompleteFunctionPath(parseMessagePath("/t.v.@deg2rad")!, plotSupport)).toBe(false);
  });
});
