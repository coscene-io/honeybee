// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Point updates and half-open range minimum queries over a fixed set of coordinates. */
export class MinimumIndex {
  readonly #size: number;
  readonly #values: Float64Array;

  public constructor(length: number) {
    this.#size = 2 ** Math.ceil(Math.log2(Math.max(1, length)));
    this.#values = new Float64Array(this.#size * 2).fill(Infinity);
  }

  public set(index: number, value: number): void {
    let node = this.#size + index;
    this.#values[node] = value;
    while (node > 1) {
      node >>>= 1;
      this.#values[node] = Math.min(this.#values[node * 2]!, this.#values[node * 2 + 1]!);
    }
  }

  public minimum(start: number, end: number): number {
    let left = start + this.#size;
    let right = end + this.#size;
    let result = Infinity;
    while (left < right) {
      if ((left & 1) !== 0) {
        result = Math.min(result, this.#values[left++]!);
      }
      if ((right & 1) !== 0) {
        result = Math.min(result, this.#values[--right]!);
      }
      left >>>= 1;
      right >>>= 1;
    }
    return result;
  }
}

/** Returns the first index where a monotone predicate is false. */
export function partitionPoint(length: number, before: (index: number) => boolean): number {
  let left = 0;
  let right = length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (before(mid)) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}
