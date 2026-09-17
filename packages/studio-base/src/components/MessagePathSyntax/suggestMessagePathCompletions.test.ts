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

import { MessagePathStructureItem } from "@foxglove/message-path";

import { suggestFunctionSuffixes, validateMessagePathInput } from "./suggestMessagePathCompletions";

const plotSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: true,
  globalVariables: {},
};

const noFunctionSupport = {
  supportsMessagePathFunctions: false,
  supportsTimeSeriesMessagePathFunctions: false,
  globalVariables: {},
};

const floatItem: MessagePathStructureItem = {
  structureType: "primitive",
  primitiveType: "float64",
  datatype: "float64",
};

const quatItem: MessagePathStructureItem = {
  structureType: "message",
  datatype: "Quaternion",
  nextByName: { x: floatItem, y: floatItem, z: floatItem, w: floatItem },
};

const timeItem: MessagePathStructureItem = {
  structureType: "message",
  datatype: "time",
  nextByName: {
    sec: { structureType: "primitive", primitiveType: "uint32", datatype: "" },
    nsec: { structureType: "primitive", primitiveType: "uint32", datatype: "" },
  },
};

describe("suggestFunctionSuffixes", () => {
  it("suggests scalar and operand on a number", () => {
    const items = suggestFunctionSuffixes({ terminatingItem: floatItem, support: plotSupport });
    expect(items).toEqual(expect.arrayContaining(["@abs", "@mul(", "@degrees", "@derivative"]));
  });

  it.each(["time", "duration", "foxglove.Time"])(
    "suggests numeric functions on Time-shaped %s",
    (datatype) => {
      const items = suggestFunctionSuffixes({
        terminatingItem: { ...timeItem, datatype },
        support: plotSupport,
      });
      expect(items).toEqual(expect.arrayContaining(["@abs", "@mul(", "@derivative"]));
      expect(items).not.toContain("@norm");
    },
  );

  it("omits time-series when disabled", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: floatItem,
      support: { ...plotSupport, supportsTimeSeriesMessagePathFunctions: false },
    });
    expect(items).not.toContain("@derivative");
    expect(items).toContain("@abs");
  });

  it("does not suggest norm for Time arrays or Time-valued vector coordinates", () => {
    expect(
      suggestFunctionSuffixes({
        terminatingItem: { structureType: "array", next: timeItem, datatype: "time[]" },
        support: plotSupport,
      }),
    ).toEqual(["@length"]);
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "message",
          nextByName: { x: timeItem, y: timeItem },
          datatype: "Times",
        },
        support: plotSupport,
      }),
    ).toEqual([]);
  });

  it("does not suggest a second time-series function", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: floatItem,
      support: plotSupport,
      functionChain: [{ function: "derivative" }],
    });
    expect(items).toEqual(expect.arrayContaining(["@abs", "@mul("]));
    expect(items).not.toEqual(expect.arrayContaining(["@delta", "@derivative", "@timedelta"]));
  });

  it("suggests length on arrays and norm on xyz", () => {
    const arrayItems = suggestFunctionSuffixes({
      terminatingItem: { structureType: "array", next: floatItem, datatype: "float64[]" },
      support: plotSupport,
    });
    expect(arrayItems).toEqual(["@length", "@norm"]);
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "message",
          datatype: "Vector3",
          nextByName: { x: floatItem, y: floatItem, z: floatItem },
        },
        support: plotSupport,
      }),
    ).toEqual(["@norm"]);
  });

  it("suggests scalars after a struct field conversion", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: quatItem,
      support: plotSupport,
      functionChain: [{ function: "rpy", fieldAccess: "yaw" }],
    });
    expect(items).toEqual(expect.arrayContaining(["@degrees", "@abs"]));
    expect(items).not.toContain("@rpy.yaw");
  });

  it("suggests quat fields after a whole-struct rpy conversion", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: quatItem,
      support: plotSupport,
      functionChain: [{ function: "rpy" }],
    });
    expect(items).toEqual(["@quat.x", "@quat.y", "@quat.z", "@quat.w"]);
  });

  it("suggests rpy fields on a quaternion-shaped message", () => {
    const items = suggestFunctionSuffixes({ terminatingItem: quatItem, support: plotSupport });
    expect(items).toEqual(expect.arrayContaining(["@rpy.yaw", "@rpy.roll", "@rpy.pitch"]));
  });

  it("suggests nothing after an inapplicable chain or when functions are disabled", () => {
    expect(
      suggestFunctionSuffixes({
        terminatingItem: floatItem,
        support: plotSupport,
        functionChain: [{ function: "length" }],
      }),
    ).toEqual([]);
    expect(
      suggestFunctionSuffixes({ terminatingItem: floatItem, support: noFunctionSupport }),
    ).toEqual([]);
  });
});

describe("validateMessagePathInput", () => {
  it("errors when functions are disabled", () => {
    expect(validateMessagePathInput("/t.v.@abs", noFunctionSupport)).toBe(
      "This field does not accept functions",
    );
  });

  it("allows quoted names containing .@ when functions are disabled", () => {
    expect(validateMessagePathInput(`"/foo.@bar".value`, noFunctionSupport)).toBeUndefined();
    expect(validateMessagePathInput(`/topic."value.@raw"`, noFunctionSupport)).toBeUndefined();
  });

  it.each([
    { path: "/t.v.@", expected: "Incomplete expression" },
    { path: "/t.v.@rpy.", expected: "Incomplete expression" },
    { path: "/t.v.@mul(", expected: "Incomplete expression" },
    { path: "/t.v.@mul(3.6", expected: "Incomplete expression" },
    { path: "/t.v.@mul($scale", expected: "Incomplete expression" },
    { path: "/t.v.@abs#", expected: "Invalid expression" },
    { path: "/t.v.@abs", expected: undefined },
  ])("validateMessagePathInput($path)", ({ path, expected }) => {
    expect(validateMessagePathInput(path, plotSupport)).toBe(expected);
  });

  it("type-checks the chain against the terminating item", () => {
    expect(validateMessagePathInput("/t.v.@length", plotSupport, floatItem)).toMatch(
      /cannot be applied/,
    );
    expect(validateMessagePathInput("/t.q.@rpy.yaw", plotSupport, quatItem)).toBeUndefined();
  });
});

it("supports topic-only timedelta and scalar completions after it", () => {
  for (const path of ["/t.@timedelta", "/t{mode==1}.@timedelta", "/t.@timedelta.@mul(1000)"]) {
    expect(validateMessagePathInput(path, plotSupport, quatItem)).toBeUndefined();
  }
  expect(validateMessagePathInput("/t.q.@timedelta", plotSupport, quatItem)).toMatch(
    /cannot be applied/,
  );
  expect(
    suggestFunctionSuffixes({ terminatingItem: quatItem, support: plotSupport, isTopic: true }),
  ).toContain("@timedelta");
  expect(
    suggestFunctionSuffixes({ terminatingItem: quatItem, support: plotSupport }),
  ).not.toContain("@timedelta");
  expect(
    suggestFunctionSuffixes({
      terminatingItem: quatItem,
      support: { ...plotSupport, supportsTimeSeriesMessagePathFunctions: false },
      isTopic: true,
    }),
  ).not.toContain("@timedelta");
  const items = suggestFunctionSuffixes({
    terminatingItem: quatItem,
    support: plotSupport,
    isTopic: true,
    functionChain: [{ function: "timedelta" }],
  });
  expect(items).toContain("@mul(");
  expect(items).not.toContain("@timedelta");
});
