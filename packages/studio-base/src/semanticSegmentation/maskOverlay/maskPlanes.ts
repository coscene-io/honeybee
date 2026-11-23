// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Bit planes for the GPU mask overlay. One texel per source pixel, one bit per instance slot, so
 * overlapping instances never overwrite each other. The plane is stored TRANSPOSED (texture width =
 * image height): the texel at row x, column y sits at offset x * height + y, which is exactly the
 * column-major index COCO RLE runs walk. Each foreground run is therefore one contiguous fill.
 */

import { decodeCounts } from "../maskCodec";

/** Instances per frame-camera the overlay can show; beyond this the overlay reports truncation. */
export const MAX_MASK_SLOTS = 64;

export type MaskPlaneFormat = "R8UI" | "R16UI" | "R32UI";

export type MaskPlanes = {
  width: number;
  height: number;
  slots: number;
  format: MaskPlaneFormat;
  /** One plane for <= 32 slots, two (slots 0-31, 32-63) above. */
  planes: (Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>)[];
  /** Foreground pixels per slot. */
  areas: number[];
  buildMs: number;
};

export function planeFormat(slots: number): MaskPlaneFormat {
  return slots <= 8 ? "R8UI" : slots <= 16 ? "R16UI" : "R32UI";
}

export function planeBytes(width: number, height: number, slots: number): number {
  const bpp = { R8UI: 1, R16UI: 2, R32UI: 4 }[planeFormat(slots)];
  return width * height * bpp * (slots > 32 ? 2 : 1);
}

export function buildMaskPlanes(
  width: number,
  height: number,
  counts: readonly string[],
): MaskPlanes {
  const started = performance.now();
  const slots = counts.length;
  if (slots > MAX_MASK_SLOTS) {
    throw new Error(`The mask overlay holds at most ${MAX_MASK_SLOTS} instances per frame`);
  }
  if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) {
    throw new Error("A mask needs the positive decoded frame size of its topic");
  }
  const total = width * height;
  const format = planeFormat(slots);
  const make = () =>
    format === "R8UI"
      ? new Uint8Array(total)
      : format === "R16UI"
        ? new Uint16Array(total)
        : new Uint32Array(total);
  const planes = slots > 32 ? [make(), make()] : [make()];
  const areas: number[] = [];
  counts.forEach((value, slot) => {
    const plane = planes[slot >> 5]!;
    const bit = (1 << (slot & 31)) >>> 0;
    const runs = decodeCounts(value);
    let position = 0;
    let area = 0;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      if (i % 2 === 1 && run > 0) {
        const end = position + run;
        for (let index = position; index < end && index < total; index++) {
          plane[index] = plane[index]! | bit;
        }
        area += run;
      }
      position += run;
    }
    if (position !== total) {
      throw new Error(
        `RLE counts cover ${position} pixels, but the bound ${width}×${height} frame has ${total}`,
      );
    }
    areas.push(area);
  });
  return { width, height, slots, format, planes, areas, buildMs: performance.now() - started };
}
