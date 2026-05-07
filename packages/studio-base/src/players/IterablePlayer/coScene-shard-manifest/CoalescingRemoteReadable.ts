// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import type { McapTypes } from "@mcap/core";

import { BareRemoteReadable } from "./BareRemoteReadable";

// Wraps BareRemoteReadable with a single look-ahead window cache. Each cache
// miss issues one HTTP range request that covers at least `readAheadBytes`
// bytes from the requested offset (clamped to the file). Subsequent reads
// that fall inside the window are served locally — so a long sequential scan
// (the dominant pattern during playback) collapses many small chunk reads
// into a few big range requests.
//
// One window per instance keeps the bookkeeping trivial: a backwards seek or
// a jump beyond the current window simply triggers a fresh fetch. Memory cost
// is bounded by readAheadBytes per open shard.
export class CoalescingRemoteReadable implements McapTypes.IReadable {
  #bare: BareRemoteReadable;
  #readAhead: bigint;
  #fileSize?: bigint;
  #window?: { offset: bigint; end: bigint; data: Uint8Array };

  public constructor(url: string, readAheadBytes: number) {
    this.#bare = new BareRemoteReadable(url);
    this.#readAhead = BigInt(Math.max(0, Math.floor(readAheadBytes)));
  }

  public async open(): Promise<void> {
    await this.#bare.open();
    this.#fileSize = await this.#bare.size();
  }

  public async size(): Promise<bigint> {
    if (this.#fileSize == undefined) {
      await this.open();
    }
    return this.#fileSize!;
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (size === 0n) return new Uint8Array();
    if (offset < 0n || size < 0n) {
      throw new Error(`CoalescingRemoteReadable.read invalid input ${offset} ${size}`);
    }

    const win = this.#window;
    if (win && offset >= win.offset && offset + size <= win.end) {
      const start = Number(offset - win.offset);
      return win.data.subarray(start, start + Number(size));
    }

    const fileSize = await this.size();
    if (offset + size > fileSize) {
      throw new Error(
        `CoalescingRemoteReadable.read past end of file: offset=${offset} size=${size} fileSize=${fileSize}`,
      );
    }

    // Fetch at least the requested bytes; extend up to the read-ahead window
    // (clamped to the remaining file).
    const requested = size > this.#readAhead ? size : this.#readAhead;
    const remaining = fileSize - offset;
    const fetchSize = requested < remaining ? requested : remaining;

    const data = await this.#bare.read(offset, fetchSize);
    this.#window = { offset, end: offset + fetchSize, data };
    return data.subarray(0, Number(size));
  }
}
