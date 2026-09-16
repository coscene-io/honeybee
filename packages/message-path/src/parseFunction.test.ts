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

import { parseFunction, STRUCT_FUNCTION_NAMES } from "./parseFunction";

describe("parseFunction", () => {
  it("parses a bare name", () => {
    expect(parseFunction("abs")).toEqual({ name: "abs" });
  });

  it("parses a numeric operand", () => {
    expect(parseFunction("mul(3.6)")).toEqual({
      name: "mul",
      operand: 3.6,
      operandRaw: "3.6",
    });
  });

  it("parses a variable operand", () => {
    expect(parseFunction("add($scale)")).toEqual({
      name: "add",
      operandRaw: "$scale",
    });
  });

  it("strips one pair of quotes around the operand", () => {
    expect(parseFunction(`mul("3.6")`)).toEqual({
      name: "mul",
      operand: 3.6,
      operandRaw: "3.6",
    });
  });

  it("treats empty parentheses as name-only", () => {
    expect(parseFunction("abs()")).toEqual({ name: "abs" });
  });

  it("returns undefined for an empty string", () => {
    expect(parseFunction("")).toBeUndefined();
  });
});

describe("STRUCT_FUNCTION_NAMES", () => {
  it("contains the 3.1.1 struct functions", () => {
    expect([...STRUCT_FUNCTION_NAMES].sort()).toEqual(["quat", "rpy", "ypr", "yrp"]);
  });
});
