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

import { splitTimeSeriesFunctionChain } from "./splitTimeSeriesFunctionChain";

describe("splitTimeSeriesFunctionChain", () => {
  it("keeps a scalar-only chain on the path", () => {
    const path = parseMessagePath("/t.v.@abs")!;
    const split = splitTimeSeriesFunctionChain(path);
    expect(split.specialFunction).toBeUndefined();
    expect(split.pathBeforeSpecialFunction.functionChain).toEqual([{ function: "abs" }]);
    expect(split.postSpecialScalarFunctions).toEqual([]);
  });

  it("splits @mul then @derivative then @abs", () => {
    const split = splitTimeSeriesFunctionChain(parseMessagePath("/t.v.@mul(2).@derivative.@abs")!);
    expect(split.pathBeforeSpecialFunction.functionChain).toEqual([{ function: "mul(2)" }]);
    expect(split.specialFunction).toBe("derivative");
    expect(split.postSpecialScalarFunctions).toHaveLength(1);
    expect(split.postSpecialScalarFunctions[0]!(-4)).toBe(4);
  });
});
