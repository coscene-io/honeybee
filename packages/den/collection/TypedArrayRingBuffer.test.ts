// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypedArrayRingBuffer } from "./TypedArrayRingBuffer";

describe("TypedArrayRingBuffer", () => {
  it("keeps only the newest values after wrapping", () => {
    const values = new TypedArrayRingBuffer(Float64Array, 3);
    values.append(1);
    values.append(2);
    values.append(3);
    values.append(4);
    values.append(5);

    expect(values.length()).toBe(3);
    expect(values.at(0)).toBe(3);
    expect(values.at(-1)).toBe(5);
    expect([...values.toArray()]).toEqual([3, 4, 5]);
  });

  it("clears wrapped state and supports bigint values", () => {
    const values = new TypedArrayRingBuffer(BigUint64Array, 2);
    values.append(1n);
    values.append(2n);
    values.append(3n);
    values.clear();
    values.append(4n);

    expect(values.toArray()).toEqual(new BigUint64Array([4n]));
  });

  it("rejects a zero capacity", () => {
    expect(() => new TypedArrayRingBuffer(Float64Array, 0)).toThrow(RangeError);
  });
});
