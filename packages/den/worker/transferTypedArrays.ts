// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

/** Collects unique, transferable ArrayBuffers without invoking object getters. */
export function collectTransferableBuffers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new WeakSet();

  const visit = (candidate: unknown): void => {
    if (candidate == undefined || typeof candidate !== "object") {
      return;
    }
    if (candidate instanceof ArrayBuffer) {
      buffers.add(candidate);
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      if (candidate.buffer instanceof ArrayBuffer) {
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
      if ("value" in descriptor) {
        visit(descriptor.value);
      }
    }
  };

  visit(value);
  return [...buffers];
}

/**
 * Marks all nested typed-array buffers for transfer across a Comlink boundary.
 * The caller must pass exclusively-owned buffers because transferring a view detaches its entire
 * backing buffer, including any sibling views.
 */
export function transferTypedArrays<T>(value: T): T {
  return Comlink.transfer(value, collectTransferableBuffers(value));
}
