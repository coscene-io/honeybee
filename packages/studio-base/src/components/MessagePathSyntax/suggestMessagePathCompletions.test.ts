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

import {
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
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "array",
          next: floatItem,
          datatype: "float64[]",
        },
        support: plotSupport,
      }),
    ).toEqual(expect.arrayContaining(["@length"]));
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
});
