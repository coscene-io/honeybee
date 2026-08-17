// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { allocatePointBudgets } from "./allocatePointBudgets";

describe("allocatePointBudgets", () => {
  it("fully funds short series before sharing the remainder", () => {
    expect(allocatePointBudgets([2, 100, 100], 12)).toEqual([2, 5, 5]);
  });

  it("uses deterministic input order for an indivisible remainder", () => {
    expect(allocatePointBudgets([100, 100, 100], 5)).toEqual([2, 2, 1]);
  });

  it("never allocates more points than a series contains", () => {
    expect(allocatePointBudgets([0, 2, 3], 100)).toEqual([0, 2, 3]);
  });

  it("rejects invalid inputs", () => {
    expect(() => allocatePointBudgets([-1], 1)).toThrow(RangeError);
    expect(() => allocatePointBudgets([1], Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
