// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { GrowableTypedArray } from "./GrowableTypedArray";

describe("GrowableTypedArray", () => {
  it("grows, appends, inserts, and clears without changing its numeric representation", () => {
    const values = new GrowableTypedArray(Float64Array, 1);

    values.append(1.25);
    values.appendAll([3.5, 4.75]);
    values.insert(1, 2.5);

    expect(values.length()).toBe(4);
    expect(values.capacity()).toBeGreaterThanOrEqual(4);
    expect(values.at(-1)).toBe(4.75);
    expect([...values.view()]).toEqual([1.25, 2.5, 3.5, 4.75]);

    values.clear();
    expect(values.length()).toBe(0);
    expect(values.capacity()).toBeGreaterThanOrEqual(4);
    expect(values.at(0)).toBeUndefined();
  });

  it("supports bigint timestamps", () => {
    const values = new GrowableTypedArray(BigUint64Array);
    values.append(1n);
    values.insert(0, 0n);

    expect(values.toArray()).toEqual(new BigUint64Array([0n, 1n]));
  });

  it("rejects invalid capacities and insertion indices", () => {
    expect(() => new GrowableTypedArray(Float64Array, -1)).toThrow(RangeError);
    const values = new GrowableTypedArray(Float64Array);
    expect(() => {
      values.insert(1, 1);
    }).toThrow(RangeError);
  });
});
