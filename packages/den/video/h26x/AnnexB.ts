// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export function isAnnexB(data: Uint8Array): boolean {
  return annexBBoxSize(data) != undefined;
}

export function annexBBoxSize(data: Uint8Array): number | undefined {
  // Annex B is a byte stream format where each NALU is prefixed with a start code, typically
  // 0x000001 or 0x00000001.
  if (data.length < 4) {
    return undefined;
  }

  if (data[0] === 0 && data[1] === 0) {
    if (data[2] === 1) {
      return 3;
    } else if (data[2] === 0 && data[3] === 1) {
      return 4;
    }
  }

  return undefined;
}

export function getFirstNaluOfType(
  data: Uint8Array,
  naluType: number,
  getType: (headerByte: number) => number,
): Uint8Array | undefined {
  const boxSize = annexBBoxSize(data);
  if (boxSize == undefined) {
    return undefined;
  }

  let i = boxSize;
  while (i < data.length) {
    const curNaluType = getType(data[i]!);
    if (curNaluType === naluType) {
      const end = findNextStartCode(data, i + 1);
      return data.subarray(i, end);
    }

    i = findNextStartCodeEnd(data, i + 1);
  }

  return undefined;
}

/**
 * Find the index of the next start code (0x000001 or 0x00000001) in the
 * given buffer, starting at the given offset.
 */
export function findNextStartCode(data: Uint8Array, start: number): number {
  let i = start;
  while (i < data.length - 3) {
    const isStartCode3Bytes = data[i + 0] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    if (isStartCode3Bytes) {
      return i;
    }
    const isStartCode4Bytes =
      i + 3 < data.length &&
      data[i + 0] === 0 &&
      data[i + 1] === 0 &&
      data[i + 2] === 0 &&
      data[i + 3] === 1;
    if (isStartCode4Bytes) {
      return i;
    }
    i++;
  }
  return data.length;
}

/**
 * Find the index of the end of the next start code (0x000001 or 0x00000001) in the
 * given buffer, starting at the given offset.
 */
export function findNextStartCodeEnd(data: Uint8Array, start: number): number {
  let i = start;
  while (i < data.length - 3) {
    const isStartCode3Bytes = data[i + 0] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    if (isStartCode3Bytes) {
      return i + 3;
    }
    const isStartCode4Bytes =
      i + 3 < data.length &&
      data[i + 0] === 0 &&
      data[i + 1] === 0 &&
      data[i + 2] === 0 &&
      data[i + 3] === 1;
    if (isStartCode4Bytes) {
      return i + 4;
    }
    i++;
  }
  return data.length;
}
