// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const DATATYPE = {
  int8: 1,
  uint8: 2,
  int16: 3,
  uint16: 4,
  int32: 5,
  uint32: 6,
  float32: 7,
  float64: 8,
};

type ByteOrder = "little" | "big";

export interface FieldReader {
  read(data: Uint8Array, index: number): number;
}

class NumericReader implements FieldReader {
  #view?: DataView;
  #data?: Uint8Array;

  public constructor(
    private readonly offset: number,
    private readonly size: number,
    private readonly getter:
      | "getInt8"
      | "getUint8"
      | "getInt16"
      | "getUint16"
      | "getInt32"
      | "getUint32"
      | "getFloat32"
      | "getFloat64",
    private readonly byteOrder: ByteOrder,
  ) {}

  public read(data: Uint8Array, index: number): number {
    const start = index + this.offset;
    if (start < 0 || start + this.size > data.byteLength) {
      throw new Error(`cannot read ${this.getter.slice(3)} from data - not enough data`);
    }
    if (data !== this.#data || this.#view == undefined) {
      this.#data = data;
      this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    return this.#view[this.getter](start, this.byteOrder === "little");
  }
}

export class Int8Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 1, "getInt8", byteOrder);
  }
}

export class Uint8Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 1, "getUint8", byteOrder);
  }
}

export class Int16Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 2, "getInt16", byteOrder);
  }
}

export class Uint16Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 2, "getUint16", byteOrder);
  }
}

export class Int32Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 4, "getInt32", byteOrder);
  }
}

export class Uint32Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 4, "getUint32", byteOrder);
  }
}

export class Float32Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 4, "getFloat32", byteOrder);
  }
}

export class Float64Reader extends NumericReader {
  public constructor(offset: number, byteOrder: ByteOrder = "little") {
    super(offset, 8, "getFloat64", byteOrder);
  }
}

export function getReader(
  datatype: number,
  offset: number,
  byteOrder: ByteOrder = "little",
): FieldReader {
  switch (datatype) {
    case DATATYPE.int8:
      return new Int8Reader(offset, byteOrder);
    case DATATYPE.uint8:
      return new Uint8Reader(offset, byteOrder);
    case DATATYPE.int16:
      return new Int16Reader(offset, byteOrder);
    case DATATYPE.uint16:
      return new Uint16Reader(offset, byteOrder);
    case DATATYPE.int32:
      return new Int32Reader(offset, byteOrder);
    case DATATYPE.uint32:
      return new Uint32Reader(offset, byteOrder);
    case DATATYPE.float32:
      return new Float32Reader(offset, byteOrder);
    case DATATYPE.float64:
      return new Float64Reader(offset, byteOrder);
    default:
      throw new Error(`Unsupported datatype: '${datatype}'`);
  }
}
