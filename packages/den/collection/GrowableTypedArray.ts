// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type NumericTypedArray =
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array;

export type TypedArrayValue<T extends NumericTypedArray> = T extends BigInt64Array | BigUint64Array
  ? bigint
  : number;

export type NumericTypedArrayConstructor<T extends NumericTypedArray> = new (length: number) => T;

const DEFAULT_INITIAL_CAPACITY = 16;

/** A compact typed array whose logical length grows independently from its capacity. */
export class GrowableTypedArray<T extends NumericTypedArray> {
  readonly #ArrayType: NumericTypedArrayConstructor<T>;
  #array: T;
  #length = 0;

  public constructor(ArrayType: NumericTypedArrayConstructor<T>, initialCapacity = 0) {
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 0) {
      throw new RangeError("initialCapacity must be a non-negative safe integer");
    }
    this.#ArrayType = ArrayType;
    this.#array = new ArrayType(initialCapacity);
  }

  public length(): number {
    return this.#length;
  }

  public capacity(): number {
    return this.#array.length;
  }

  public at(index: number): TypedArrayValue<T> | undefined {
    const normalizedIndex = index < 0 ? this.#length + index : index;
    if (normalizedIndex < 0 || normalizedIndex >= this.#length) {
      return undefined;
    }
    return this.#array[normalizedIndex] as TypedArrayValue<T>;
  }

  public append(value: TypedArrayValue<T>): void {
    this.#ensureCapacity(this.#length + 1);
    this.#array[this.#length] = value;
    this.#length++;
  }

  public appendAll(values: ArrayLike<TypedArrayValue<T>>): void {
    if (values.length === 0) {
      return;
    }
    this.#ensureCapacity(this.#length + values.length);
    for (let index = 0; index < values.length; index++) {
      this.#array[this.#length + index] = values[index] as never;
    }
    this.#length += values.length;
  }

  public insert(index: number, value: TypedArrayValue<T>): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.#length) {
      throw new RangeError("index is outside the logical array bounds");
    }
    this.#ensureCapacity(this.#length + 1);
    this.#array.copyWithin(index + 1, index, this.#length);
    this.#array[index] = value;
    this.#length++;
  }

  public clear(): void {
    this.#length = 0;
  }

  /** Returns a view over the live values. The view is invalidated by a later resize. */
  public view(): T {
    return this.#array.subarray(0, this.#length) as T;
  }

  public toArray(): T {
    return this.#array.slice(0, this.#length) as T;
  }

  #ensureCapacity(requiredCapacity: number): void {
    if (requiredCapacity <= this.#array.length) {
      return;
    }

    let nextCapacity = Math.max(DEFAULT_INITIAL_CAPACITY, this.#array.length);
    while (nextCapacity < requiredCapacity) {
      nextCapacity *= 2;
    }

    const nextArray = new this.#ArrayType(nextCapacity);
    nextArray.set(this.#array.subarray(0, this.#length) as never);
    this.#array = nextArray;
  }
}
