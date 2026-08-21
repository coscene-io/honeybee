// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { fromNanoSec, isTime, toNanoSec } from "@foxglove/rostime";

import { OriginalValue } from "./datum";

enum PackedValueKind {
  Undefined,
  Number,
  Boolean,
  PositiveBigInt,
  NegativeBigInt,
  Time,
  String,
  Fallback,
}

const MAX_UINT64 = (1n << 64n) - 1n;

export type PackedDatasetData = {
  /** Interleaved x/y pairs. This buffer is always owned by one viewport response. */
  points: Float64Array;
  valueKinds: Uint8Array;
  valuePayloads: BigUint64Array;
  strings: string[];
  /** Exceptional values which cannot be represented by the compact 64-bit columns. */
  fallbackValues: OriginalValue[];
};

export type UnpackedDatum = { x: number; y: number; value?: OriginalValue };

/** Builds an exact-sized, transferable viewport buffer without allocating a Datum per point. */
export class PackedDatasetWriter {
  readonly #points: Float64Array;
  readonly #valueKinds: Uint8Array;
  readonly #valuePayloads: BigUint64Array;
  readonly #strings: string[] = [];
  readonly #stringIds = new Map<string, number>();
  readonly #fallbackValues: OriginalValue[] = [];

  public constructor(length: number) {
    this.#points = new Float64Array(length * 2);
    this.#valueKinds = new Uint8Array(length);
    this.#valuePayloads = new BigUint64Array(length);
  }

  public set(index: number, x: number, y: number, value?: OriginalValue): void {
    this.#points[index * 2] = x;
    this.#points[index * 2 + 1] = y;

    if (value == undefined) {
      this.#valueKinds[index] = PackedValueKind.Undefined;
      return;
    }

    switch (typeof value) {
      case "number":
        this.#valueKinds[index] = PackedValueKind.Number;
        return;
      case "boolean":
        this.#valueKinds[index] = PackedValueKind.Boolean;
        return;
      case "bigint": {
        const magnitude = value < 0n ? -value : value;
        if (magnitude <= MAX_UINT64) {
          this.#valueKinds[index] =
            value < 0n ? PackedValueKind.NegativeBigInt : PackedValueKind.PositiveBigInt;
          this.#valuePayloads[index] = magnitude;
        } else {
          this.#setFallback(index, value);
        }
        return;
      }
      case "string": {
        let stringId = this.#stringIds.get(value);
        if (stringId == undefined) {
          stringId = this.#strings.length;
          this.#strings.push(value);
          this.#stringIds.set(value, stringId);
        }
        this.#valueKinds[index] = PackedValueKind.String;
        this.#valuePayloads[index] = BigInt(stringId);
        return;
      }
      case "object": {
        if (isTime(value) && isCanonicalNonnegativeTime(value)) {
          try {
            const nanoseconds = toNanoSec(value);
            if (nanoseconds >= 0n && nanoseconds <= MAX_UINT64) {
              this.#valueKinds[index] = PackedValueKind.Time;
              this.#valuePayloads[index] = nanoseconds;
              return;
            }
          } catch {
            // Legacy data can contain fractional seconds. Preserve it in the sparse fallback.
          }
          this.#setFallback(index, value);
          return;
        }
        this.#setFallback(index, value);
        return;
      }
    }
  }

  public finish(): PackedDatasetData {
    return {
      points: this.#points,
      valueKinds: this.#valueKinds,
      valuePayloads: this.#valuePayloads,
      strings: this.#strings,
      fallbackValues: this.#fallbackValues,
    };
  }

  #setFallback(index: number, value: OriginalValue): void {
    this.#valueKinds[index] = PackedValueKind.Fallback;
    this.#valuePayloads[index] = BigInt(this.#fallbackValues.length);
    this.#fallbackValues.push(value);
  }
}

function isCanonicalNonnegativeTime(value: { sec: number; nsec: number }): boolean {
  return (
    Number.isSafeInteger(value.sec) &&
    value.sec >= 0 &&
    Number.isSafeInteger(value.nsec) &&
    value.nsec >= 0 &&
    value.nsec < 1_000_000_000
  );
}

export function unpackPackedDatasetData(data: PackedDatasetData): UnpackedDatum[] {
  const length = data.points.length / 2;
  const result = new Array<UnpackedDatum>(length);
  for (let index = 0; index < length; index++) {
    const x = data.points[index * 2]!;
    const y = data.points[index * 2 + 1]!;
    const kind = data.valueKinds[index] as PackedValueKind;
    const payload = data.valuePayloads[index]!;
    let value: OriginalValue | undefined;

    switch (kind) {
      case PackedValueKind.Undefined:
        break;
      case PackedValueKind.Number:
        value = y;
        break;
      case PackedValueKind.Boolean:
        value = y !== 0;
        break;
      case PackedValueKind.PositiveBigInt:
        value = payload;
        break;
      case PackedValueKind.NegativeBigInt:
        value = -payload;
        break;
      case PackedValueKind.Time:
        value = fromNanoSec(payload);
        break;
      case PackedValueKind.String:
        value = data.strings[Number(payload)];
        break;
      case PackedValueKind.Fallback:
        value = data.fallbackValues[Number(payload)];
        break;
    }

    result[index] = value == undefined ? { x, y } : { x, y, value };
  }
  return result;
}

/**
 * Keeps direct builder callers and legacy tests source-compatible without putting Datum objects on
 * either structured-clone boundary. Structured clone ignores this non-enumerable accessor.
 */
export function attachUnpackedDataAccessor<T extends { packedData: PackedDatasetData }>(
  dataset: T,
): T & { readonly data: UnpackedDatum[] } {
  Object.defineProperty(dataset, "data", {
    configurable: false,
    enumerable: false,
    get: () => unpackPackedDatasetData(dataset.packedData),
  });
  return dataset as T & { readonly data: UnpackedDatum[] };
}

export function restoreUnpackedDataAccessor(dataset: { packedData?: PackedDatasetData }): void {
  const packedData = dataset.packedData;
  if (packedData && !Object.prototype.hasOwnProperty.call(dataset, "data")) {
    Object.defineProperty(dataset, "data", {
      configurable: false,
      enumerable: false,
      get: () => unpackPackedDatasetData(packedData),
    });
  }
}

export function getPackedDatasetTransferables(data: PackedDatasetData): ArrayBuffer[] {
  // These columns are constructed locally with a numeric length, so their backing stores cannot
  // be SharedArrayBuffers. Avoid `instanceof ArrayBuffer`, which fails across browser/Jest realms.
  return [
    data.points.buffer as ArrayBuffer,
    data.valueKinds.buffer as ArrayBuffer,
    data.valuePayloads.buffer as ArrayBuffer,
  ];
}
