// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264 } from "../h264";
import { H265 } from "../h265";
import { annexBBoxSize } from "./AnnexB";

type Bytes = Uint8Array | readonly number[];

// Slice and PPS prefixes are short. Read only the syntax needed for diagnosis, stripping
// emulation-prevention bytes and rejecting truncated or overlong Exp-Golomb codes.
class HeaderReader {
  #offset: number;
  #bits = 0;
  #byte = 0;
  #zeros = 0;
  public constructor(
    private data: Bytes,
    start: number,
    private end: number,
  ) {
    this.#offset = start;
  }
  public bit(): number {
    if (this.#bits === 0) {
      if (this.#zeros === 2 && this.data[this.#offset] === 3) {
        this.#offset++;
        this.#zeros = 0;
      }
      if (this.#offset >= this.end) {
        throw new RangeError("Truncated video header");
      }
      this.#byte = this.data[this.#offset++]!;
      this.#zeros = this.#byte === 0 ? Math.min(2, this.#zeros + 1) : 0;
      this.#bits = 8;
    }
    return (this.#byte >> --this.#bits) & 1;
  }
  public bits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      value = 2 * value + this.bit();
    }
    return value;
  }
  public ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      if (++zeros > 24) {
        throw new RangeError("Invalid video header");
      }
    }
    return 2 ** zeros - 1 + this.bits(zeros);
  }
}

export type PacketInspection = {
  key: boolean;
  bFrame?: boolean;
  reorder?: boolean;
  missing: string[];
  problem?: "empty" | "annexB" | "malformed";
};

function nextDelimiter(data: Bytes, start: number): number {
  let one = data.indexOf(1, start + 2);
  while (one >= 0) {
    if (data[one - 1] === 0 && data[one - 2] === 0) {
      return one;
    }
    one = data.indexOf(1, one + 1);
  }
  return data.length;
}

/** Inspect one Annex B access unit. PPS slice-header layout is scoped to a continuous stream. */
export function inspectVideoPacket(
  format: string,
  data: Bytes,
  pps: Map<number, number>,
): PacketInspection {
  const result: PacketInspection = { key: false, missing: [] };
  let start = annexBBoxSize(data);
  if (start == undefined) {
    return { ...result, problem: data.length === 0 ? "empty" : "annexB" };
  }
  const hevc = format === "h265";
  const seen = new Set<number>();
  let unknownSlice = false;
  let bSlice = false;
  let sliceCount = 0;
  try {
    while (start < data.length) {
      const next = nextDelimiter(data, start);
      let end = next === data.length ? next : next - 2;
      while (end > start && data[end - 1] === 0) {
        end--;
      }
      const header = data[start]!;
      const type = hevc ? (header >> 1) & 63 : header & 31;
      const headerEnd = start + (hevc ? 2 : 1);
      if ((header & 128) !== 0 || headerEnd >= end || (hevc && (data[start + 1]! & 7) === 0)) {
        throw new RangeError("Invalid NAL header");
      }
      seen.add(type);
      result.key ||= hevc ? type >= 16 && type <= 21 : type === 5;
      const reader = new HeaderReader(data, headerEnd, end);
      if (hevc && type === 34) {
        const id = reader.ue();
        if (id > 63 || reader.ue() > 15) {
          throw new RangeError("Invalid PPS identifier");
        }
        reader.bits(2);
        pps.set(id, reader.bits(3));
      } else if (hevc && type <= 31) {
        sliceCount++;
        if (reader.bit() === 0) {
          unknownSlice = true; // A dependent/non-first slice needs additional SPS geometry.
        } else {
          if (type >= 16 && type <= 23) {
            reader.bit();
          }
          const extra = pps.get(reader.ue());
          if (extra == undefined) {
            unknownSlice = true;
          } else {
            reader.bits(extra);
            const slice = reader.ue();
            if (slice > 2) {
              throw new RangeError("Invalid HEVC slice type");
            }
            bSlice ||= slice === 0;
          }
        }
      } else if (!hevc && (type === 1 || type === 2 || type === 5)) {
        sliceCount++;
        reader.ue();
        const slice = reader.ue();
        if (slice > 9) {
          throw new RangeError("Invalid AVC slice type");
        }
        bSlice ||= slice % 5 === 1;
      }
      if (type === (hevc ? 33 : 7) && end - start < 4096) {
        // Reuse the codec's SPS parser only for a bounded parameter set, never copy the frame.
        const sps = new Uint8Array(3 + end - start);
        sps[2] = 1;
        sps.set(data instanceof Uint8Array ? data.subarray(start, end) : data.slice(start, end), 3);
        result.reorder = hevc ? H265.HasBFrames(sps) : H264.HasBFrames(sps);
      }
      start = next + 1;
    }
    if (sliceCount === 0) {
      result.problem = "malformed";
    }
    if (bSlice || (!unknownSlice && sliceCount > 0)) {
      result.bFrame = bSlice;
    }
    if (result.key) {
      if (hevc && !seen.has(32)) {
        result.missing.push("VPS");
      }
      if (!seen.has(hevc ? 33 : 7)) {
        result.missing.push("SPS");
      }
      if (hevc && !seen.has(34)) {
        result.missing.push("PPS");
      }
    }
  } catch {
    result.problem = "malformed";
  }
  return result;
}
