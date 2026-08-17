// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { compare, fromNanoSec, isTime, toNanoSec } from "@foxglove/rostime";
import { Immutable, Time } from "@foxglove/studio";

import { OriginalValue } from "../datum";

export type ValueItem = {
  value: number;
  originalValue: OriginalValue;
  receiveTime: Time;
};

export type ValueItemBatch = {
  values: Float64Array;
  receiveTimes: BigUint64Array;
  valueKinds: Uint8Array;
  valuePayloads: BigUint64Array;
  strings: string[];
  fallbackValues: OriginalValue[];
  fallbackTimes: Time[];
};

const MAX_UINT64 = (1n << 64n) - 1n;
const TIME_FALLBACK_BASE = MAX_UINT64 - (1n << 32n);

enum StoredValueKind {
  Number,
  Boolean,
  PositiveBigInt,
  NegativeBigInt,
  Time,
  String,
  Fallback,
}

class StoredValueCodec {
  readonly #strings: string[] = [];
  readonly #stringIds = new Map<string, number>();
  readonly #fallbackValues: OriginalValue[] = [];

  public sideTableEntryCount(): number {
    return this.#strings.length + this.#fallbackValues.length;
  }

  public encode(value: OriginalValue): readonly [StoredValueKind, bigint] {
    switch (typeof value) {
      case "number":
        return [StoredValueKind.Number, 0n];
      case "boolean":
        return [StoredValueKind.Boolean, 0n];
      case "bigint": {
        const magnitude = value < 0n ? -value : value;
        if (magnitude <= MAX_UINT64) {
          return [
            value < 0n ? StoredValueKind.NegativeBigInt : StoredValueKind.PositiveBigInt,
            magnitude,
          ];
        }
        return this.#encodeFallback(value);
      }
      case "string": {
        let id = this.#stringIds.get(value);
        if (id == undefined) {
          id = this.#strings.length;
          this.#strings.push(value);
          this.#stringIds.set(value, id);
        }
        return [StoredValueKind.String, BigInt(id)];
      }
      case "object": {
        if (isTime(value) && isCanonicalNonnegativeTime(value)) {
          try {
            const nanoseconds = toNanoSec(value);
            if (nanoseconds >= 0n && nanoseconds <= MAX_UINT64) {
              return [StoredValueKind.Time, nanoseconds];
            }
          } catch {
            // Preserve malformed legacy Time values in the exceptional side table.
          }
        }
        return this.#encodeFallback(value);
      }
    }
  }

  public decode(kind: StoredValueKind, payload: bigint, numericValue: number): OriginalValue {
    switch (kind) {
      case StoredValueKind.Number:
        return numericValue;
      case StoredValueKind.Boolean:
        return numericValue !== 0;
      case StoredValueKind.PositiveBigInt:
        return payload;
      case StoredValueKind.NegativeBigInt:
        return -payload;
      case StoredValueKind.Time:
        return fromNanoSec(payload);
      case StoredValueKind.String:
        return this.#strings[Number(payload)] ?? "";
      case StoredValueKind.Fallback:
        return this.#fallbackValues[Number(payload)] ?? numericValue;
    }
  }

  public strings(): string[] {
    return this.#strings;
  }

  public fallbackValues(): OriginalValue[] {
    return this.#fallbackValues;
  }

  #encodeFallback(value: OriginalValue): readonly [StoredValueKind, bigint] {
    const index = this.#fallbackValues.length;
    this.#fallbackValues.push(value);
    return [StoredValueKind.Fallback, BigInt(index)];
  }
}

class StoredTimeCodec {
  readonly #fallbackTimes: Time[] = [];

  public sideTableEntryCount(): number {
    return this.#fallbackTimes.length;
  }

  public encode(value: Immutable<Time>): bigint {
    try {
      if (!isCanonicalNonnegativeTime(value)) {
        throw new RangeError("Timestamp is not in canonical form");
      }
      const nanoseconds = toNanoSec(value);
      if (nanoseconds >= 0n && nanoseconds < TIME_FALLBACK_BASE) {
        return nanoseconds;
      }
    } catch {
      // Fractional and otherwise non-canonical timestamps existed in older fixtures.
    }
    const index = this.#fallbackTimes.length;
    if (index >= 0xffff_ffff) {
      throw new RangeError("Too many exceptional timestamps in a plot series");
    }
    this.#fallbackTimes.push({ sec: value.sec, nsec: value.nsec });
    return TIME_FALLBACK_BASE + BigInt(index);
  }

  public decode(value: bigint): Time {
    if (value >= TIME_FALLBACK_BASE) {
      return this.#fallbackTimes[Number(value - TIME_FALLBACK_BASE)] ?? { sec: 0, nsec: 0 };
    }
    return fromNanoSec(value);
  }

  public fallbackTimes(): Time[] {
    return this.#fallbackTimes;
  }
}

/** Encodes one main-thread extraction batch into exclusively-owned transferable columns. */
export function encodeValueItems(items: Immutable<ValueItem[]>): ValueItemBatch {
  const length = items.length;
  const values = new Float64Array(length);
  const receiveTimes = new BigUint64Array(length);
  const valueKinds = new Uint8Array(length);
  const valuePayloads = new BigUint64Array(length);
  const valueCodec = new StoredValueCodec();
  const timeCodec = new StoredTimeCodec();
  for (let index = 0; index < length; index++) {
    const item = items[index]!;
    values[index] = item.value;
    receiveTimes[index] = timeCodec.encode(item.receiveTime);
    const [kind, payload] = valueCodec.encode(item.originalValue);
    valueKinds[index] = kind;
    valuePayloads[index] = payload;
  }
  return {
    values,
    receiveTimes,
    valueKinds,
    valuePayloads,
    strings: valueCodec.strings(),
    fallbackValues: valueCodec.fallbackValues(),
    fallbackTimes: timeCodec.fallbackTimes(),
  };
}

/** Columnar worker-side storage. Point order is exactly the append order. */
export class CompactValueStore {
  public length = 0;
  public capacity: number;
  #values: Float64Array;
  #receiveTimes: BigUint64Array;
  #valueKinds: Uint8Array;
  #valuePayloads: BigUint64Array;
  #minimum = Infinity;
  #maximum = -Infinity;
  readonly #valueCodec = new StoredValueCodec();
  readonly #timeCodec = new StoredTimeCodec();

  public constructor(initialCapacity = 0) {
    this.capacity = initialCapacity;
    this.#values = new Float64Array(initialCapacity);
    this.#receiveTimes = new BigUint64Array(initialCapacity);
    this.#valueKinds = new Uint8Array(initialCapacity);
    this.#valuePayloads = new BigUint64Array(initialCapacity);
  }

  public sideTableEntryCount(): number {
    return this.#valueCodec.sideTableEntryCount() + this.#timeCodec.sideTableEntryCount();
  }

  public getValue(index: number): number {
    return this.#values[index]!;
  }

  public getOriginalValue(index: number): OriginalValue {
    return this.#valueCodec.decode(
      this.#valueKinds[index] as StoredValueKind,
      this.#valuePayloads[index]!,
      this.#values[index]!,
    );
  }

  public getReceiveTime(index: number): Time {
    return this.#timeCodec.decode(this.#receiveTimes[index]!);
  }

  public getBounds(end = this.length): { min: number; max: number } {
    const last = Math.min(Math.max(0, end), this.length);
    if (last === this.length) {
      return { min: this.#minimum, max: this.#maximum };
    }
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < last; index++) {
      const value = this.#values[index]!;
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    return { min, max };
  }

  public appendBatch(
    batch: Immutable<ValueItemBatch>,
    minimumReceiveTimeExclusive?: Immutable<Time>,
  ): void {
    const length = batch.values.length;
    if (
      batch.receiveTimes.length !== length ||
      batch.valueKinds.length !== length ||
      batch.valuePayloads.length !== length
    ) {
      throw new Error("Custom plot value batch columns have mismatched lengths");
    }
    if (minimumReceiveTimeExclusive == undefined) {
      this.#ensureCapacity(this.length + length);
    }
    for (let index = 0; index < length; index++) {
      const value = batch.values[index]!;
      const receiveTime = decodeBatchTime(batch, index);
      if (
        minimumReceiveTimeExclusive != undefined &&
        compare(receiveTime, minimumReceiveTimeExclusive) <= 0
      ) {
        continue;
      }
      const originalValue = decodeBatchValue(batch, index, value);
      this.#append(value, originalValue, receiveTime);
    }
  }

  public sliceFrom(start: number): CompactValueStore {
    const first = Math.min(Math.max(0, start), this.length);
    if (first === 0) {
      return this;
    }
    const result = new CompactValueStore(this.length - first);
    for (let index = first; index < this.length; index++) {
      result.#append(
        this.getValue(index),
        this.getOriginalValue(index),
        this.getReceiveTime(index),
      );
    }
    return result;
  }

  #append(value: number, originalValue: OriginalValue, receiveTime: Immutable<Time>): void {
    this.#ensureCapacity(this.length + 1);
    this.#values[this.length] = value;
    if (Number.isFinite(value)) {
      this.#minimum = Math.min(this.#minimum, value);
      this.#maximum = Math.max(this.#maximum, value);
    }
    this.#receiveTimes[this.length] = this.#timeCodec.encode(receiveTime);
    const [kind, payload] = this.#valueCodec.encode(originalValue);
    this.#valueKinds[this.length] = kind;
    this.#valuePayloads[this.length] = payload;
    this.length++;
  }

  #ensureCapacity(required: number): void {
    if (required <= this.capacity) {
      return;
    }
    let capacity = Math.max(16, this.capacity);
    while (capacity < required) {
      capacity *= 2;
    }
    const values = new Float64Array(capacity);
    values.set(this.#values.subarray(0, this.length));
    const receiveTimes = new BigUint64Array(capacity);
    receiveTimes.set(this.#receiveTimes.subarray(0, this.length));
    const valueKinds = new Uint8Array(capacity);
    valueKinds.set(this.#valueKinds.subarray(0, this.length));
    const valuePayloads = new BigUint64Array(capacity);
    valuePayloads.set(this.#valuePayloads.subarray(0, this.length));
    this.capacity = capacity;
    this.#values = values;
    this.#receiveTimes = receiveTimes;
    this.#valueKinds = valueKinds;
    this.#valuePayloads = valuePayloads;
  }
}

function decodeBatchValue(
  batch: Immutable<ValueItemBatch>,
  index: number,
  numericValue: number,
): OriginalValue {
  const kind = batch.valueKinds[index] as StoredValueKind;
  const payload = batch.valuePayloads[index]!;
  switch (kind) {
    case StoredValueKind.Number:
      return numericValue;
    case StoredValueKind.Boolean:
      return numericValue !== 0;
    case StoredValueKind.PositiveBigInt:
      return payload;
    case StoredValueKind.NegativeBigInt:
      return -payload;
    case StoredValueKind.Time:
      return fromNanoSec(payload);
    case StoredValueKind.String:
      return batch.strings[Number(payload)] ?? "";
    case StoredValueKind.Fallback:
      return batch.fallbackValues[Number(payload)] ?? numericValue;
  }
}

function decodeBatchTime(batch: Immutable<ValueItemBatch>, index: number): Time {
  const encoded = batch.receiveTimes[index]!;
  if (encoded >= TIME_FALLBACK_BASE) {
    return batch.fallbackTimes[Number(encoded - TIME_FALLBACK_BASE)] ?? { sec: 0, nsec: 0 };
  }
  return fromNanoSec(encoded);
}

function isCanonicalNonnegativeTime(value: Immutable<Time>): boolean {
  return (
    Number.isSafeInteger(value.sec) &&
    value.sec >= 0 &&
    Number.isSafeInteger(value.nsec) &&
    value.nsec >= 0 &&
    value.nsec < 1_000_000_000
  );
}
