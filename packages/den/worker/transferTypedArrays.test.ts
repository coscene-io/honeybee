// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { collectTransferableBuffers } from "./transferTypedArrays";

describe("collectTransferableBuffers", () => {
  it("collects nested buffers once and does not invoke getters", () => {
    const sharedBuffer = new ArrayBuffer(16);
    const nestedBuffer = new ArrayBuffer(4);
    const getter = jest.fn(() => new ArrayBuffer(8));
    type CyclicValue = {
      arrays: Array<Float64Array | Uint8Array>;
      map: Map<string, Set<ArrayBuffer>>;
      self?: CyclicValue;
      readonly ignored?: ArrayBuffer;
    };
    const value: CyclicValue = {
      arrays: [new Float64Array(sharedBuffer), new Uint8Array(sharedBuffer)],
      map: new Map([["nested", new Set([nestedBuffer])]]),
    };
    Object.defineProperty(value, "ignored", { enumerable: true, get: getter });
    value.self = value;

    expect(collectTransferableBuffers(value)).toEqual([sharedBuffer, nestedBuffer]);
    expect(getter).not.toHaveBeenCalled();
  });

  it("uses the ArrayBuffer brand across prototype realms and excludes shared buffers", () => {
    const foreignPrototypeBuffer = new ArrayBuffer(8);
    Object.setPrototypeOf(foreignPrototypeBuffer, {});
    expect(foreignPrototypeBuffer).not.toBeInstanceOf(ArrayBuffer);

    const values: unknown[] = [foreignPrototypeBuffer];
    if (typeof SharedArrayBuffer !== "undefined") {
      const sharedBuffer = new SharedArrayBuffer(8);
      values.push(sharedBuffer, new Uint8Array(sharedBuffer));
    }

    expect(collectTransferableBuffers(values)).toEqual([foreignPrototypeBuffer]);
  });
});
