// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

/* oxlint-disable typescript/unbound-method -- this intrinsic getter is intentionally invoked with a candidate receiver below */
// eslint-disable-next-line @typescript-eslint/unbound-method
const getArrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
/* oxlint-enable typescript/unbound-method */

/** Collects unique, transferable ArrayBuffers without invoking object getters. */
export function collectTransferableBuffers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new WeakSet();

  const visit = (candidate: unknown): void => {
    if (candidate == undefined || typeof candidate !== "object") {
      return;
    }
    if (isArrayBuffer(candidate)) {
      buffers.add(candidate);
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      if (isArrayBuffer(candidate.buffer)) {
        buffers.add(candidate.buffer);
      }
      return;
    }
    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);

    if (candidate instanceof Map) {
      for (const [key, entry] of candidate) {
        visit(key);
        visit(entry);
      }
      return;
    }
    if (candidate instanceof Set) {
      for (const entry of candidate) {
        visit(entry);
      }
      return;
    }

    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      // Structured clone serializes only enumerable own data properties. Collecting a buffer from
      // a non-enumerable property would detach state the receiver never gets.
      if (descriptor.enumerable === true && "value" in descriptor) {
        visit(descriptor.value);
      }
    }
  };

  visit(value);
  return [...buffers];
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (getArrayBufferByteLength == undefined || value == undefined || typeof value !== "object") {
    return false;
  }
  try {
    // The intrinsic getter checks the internal ArrayBuffer slot across realms without consulting
    // user properties such as Symbol.toStringTag. It rejects SharedArrayBuffer.
    getArrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks all nested typed-array buffers for transfer across a Comlink boundary.
 * The caller must pass exclusively-owned buffers because transferring a view detaches its entire
 * backing buffer, including any sibling views.
 */
export function transferTypedArrays<T>(value: T): T {
  return Comlink.transfer(value, collectTransferableBuffers(value));
}
