// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  NumericTypedArray,
  NumericTypedArrayConstructor,
  TypedArrayValue,
} from "./GrowableTypedArray";

/** A fixed-capacity typed ring buffer indexed from the oldest retained value. */
export class TypedArrayRingBuffer<T extends NumericTypedArray> {
  readonly #ArrayType: NumericTypedArrayConstructor<T>;
  readonly #array: T;
  #length = 0;
  #start = 0;

  public constructor(ArrayType: NumericTypedArrayConstructor<T>, capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive safe integer");
    }
    this.#ArrayType = ArrayType;
    this.#array = new ArrayType(capacity);
  }

  public capacity(): number {
    return this.#array.length;
  }

  public length(): number {
    return this.#length;
  }

  public append(value: TypedArrayValue<T>): void {
    const writeIndex = (this.#start + this.#length) % this.capacity();
    this.#array[writeIndex] = value;

    if (this.#length < this.capacity()) {
      this.#length++;
    } else {
      this.#start = (this.#start + 1) % this.capacity();
    }
  }

  public at(index: number): TypedArrayValue<T> | undefined {
    const normalizedIndex = index < 0 ? this.#length + index : index;
    if (normalizedIndex < 0 || normalizedIndex >= this.#length) {
      return undefined;
    }
    const physicalIndex = (this.#start + normalizedIndex) % this.capacity();
    return this.#array[physicalIndex] as TypedArrayValue<T>;
  }

  public clear(): void {
    this.#length = 0;
    this.#start = 0;
  }

  public toArray(): T {
    const result = new this.#ArrayType(this.#length);
    if (this.#length === 0) {
      return result;
    }

    const firstPartLength = Math.min(this.#length, this.capacity() - this.#start);
    result.set(this.#array.subarray(this.#start, this.#start + firstPartLength) as never, 0);
    if (firstPartLength < this.#length) {
      result.set(this.#array.subarray(0, this.#length - firstPartLength) as never, firstPartLength);
    }
    return result;
  }
}
