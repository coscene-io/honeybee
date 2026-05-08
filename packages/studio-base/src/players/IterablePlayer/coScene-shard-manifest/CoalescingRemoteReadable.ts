// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { McapTypes } from "@mcap/core";

// HTTP-served IReadable that batches small reads into bigger range requests
// and streams the response body, so callers get their bytes as soon as the
// requested prefix arrives — they don't wait for the rest of the read-ahead
// window to download.
//
// Behavior:
//   read(offset, size) —
//     - cache hit (active range covers [offset, offset+size]): wait until
//       the requested prefix has arrived, then resolve with a slice.
//     - cache miss: abort any in-flight fetch, start a new range request for
//       max(size, readAhead) bytes (clamped to file end), stream into a
//       pre-allocated buffer, resolve the caller as soon as `size` bytes are
//       available; keep streaming in the background to fill the rest of the
//       window for subsequent reads.
//
// One active window per instance: a backwards seek or a jump beyond the
// current window aborts the in-flight fetch and starts a new one. Memory
// cost is bounded by readAheadBytes per open shard.
//
// KNOWN ISSUE — seek latency under HTTP/1.1 connection limits:
//   When a seek invalidates the active window, we abort() the in-flight
//   stream and issue a new range request for the new offset. Browsers
//   limit concurrent connections per origin (typically 6 for HTTP/1.1, far
//   higher for HTTP/2), and aborting one connection doesn't always free a
//   slot synchronously — the browser may keep the socket in a half-closed
//   state until TCP cleanup completes. As a result, on backends served
//   over HTTP/1.1 a fast scrub through the timeline can stall briefly
//   waiting for the previous fetch's slot to be released before the new
//   range request begins. HTTP/2 backends don't have this problem because
//   all streams share one socket and RST_STREAM frees the slot
//   immediately. Future fix candidates: (1) keep the previous window's
//   already-downloaded bytes around as a small ring of past windows
//   instead of discarding them on abort, (2) issue the new fetch from a
//   different fetch queue / Worker, (3) skip abort when the queue is
//   nearly full and let the previous fetch finish in the background.
//   Tracked for follow-up; not blocking PoC.

type ActiveFetch = {
  offset: bigint;
  end: bigint;
  abortController: AbortController;
  buffer: Uint8Array;
  bytesDownloaded: number;
  waiters: { needed: number; resolve: () => void; reject: (e: unknown) => void }[];
  error?: unknown;
  done: boolean;
};

export class CoalescingRemoteReadable implements McapTypes.IReadable {
  #url: string;
  #readAhead: bigint;
  #fileSize: bigint;
  #active?: ActiveFetch;

  public constructor(url: string, readAheadBytes: number, fileSizeBytes: number) {
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
      throw new Error(`CoalescingRemoteReadable invalid file size: ${fileSizeBytes}`);
    }
    this.#url = url;
    this.#readAhead = BigInt(Math.max(0, Math.floor(readAheadBytes)));
    this.#fileSize = BigInt(Math.floor(fileSizeBytes));
  }

  public async open(): Promise<void> {
    return;
  }

  public async size(): Promise<bigint> {
    return this.#fileSize;
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (size === 0n) {
      return new Uint8Array();
    }
    if (offset < 0n || size < 0n) {
      throw new Error(`CoalescingRemoteReadable.read invalid input ${offset} ${size}`);
    }

    const fileSize = await this.size();
    if (offset + size > fileSize) {
      throw new Error(
        `CoalescingRemoteReadable.read past end of file: offset=${offset} size=${size} fileSize=${fileSize}`,
      );
    }

    // Active window covers this read?
    const active = this.#active;
    if (active != undefined && offset >= active.offset && offset + size <= active.end) {
      const localStart = Number(offset - active.offset);
      const neededBytes = localStart + Number(size);
      await waitForBytes(active, neededBytes);
      return active.buffer.subarray(localStart, neededBytes);
    }

    // Miss: abort any in-flight fetch and start a new streaming range fetch.
    if (active != undefined && !active.done) {
      active.abortController.abort();
    }

    const requested = size > this.#readAhead ? size : this.#readAhead;
    const remaining = fileSize - offset;
    const fetchSize = requested < remaining ? requested : remaining;

    const next = this.#startStreamingFetch(offset, fetchSize);
    this.#active = next;

    const neededBytes = Number(size);
    await waitForBytes(next, neededBytes);
    return next.buffer.subarray(0, neededBytes);
  }

  #startStreamingFetch(offset: bigint, size: bigint): ActiveFetch {
    const sizeNum = Number(size);
    const buffer = new Uint8Array(sizeNum);
    const abortController = new AbortController();
    const state: ActiveFetch = {
      offset,
      end: offset + size,
      abortController,
      buffer,
      bytesDownloaded: 0,
      waiters: [],
      done: false,
    };

    const end = offset + size - 1n;
    void runFetch(this.#url, offset, end, sizeNum, abortController.signal, state);
    return state;
  }
}

function notifyWaiters(state: ActiveFetch): void {
  const remaining: ActiveFetch["waiters"] = [];
  for (const w of state.waiters) {
    if (state.error != undefined) {
      w.reject(state.error);
    } else if (state.done || state.bytesDownloaded >= w.needed) {
      w.resolve();
    } else {
      remaining.push(w);
    }
  }
  state.waiters = remaining;
}

async function waitForBytes(state: ActiveFetch, neededBytes: number): Promise<void> {
  if (state.error != undefined) {
    throw asError(state.error);
  }
  if (state.done || state.bytesDownloaded >= neededBytes) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    state.waiters.push({ needed: neededBytes, resolve, reject });
  });
}

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown error");
  }
}

async function runFetch(
  url: string,
  offset: bigint,
  end: bigint,
  sizeNum: number,
  signal: AbortSignal,
  state: ActiveFetch,
): Promise<void> {
  try {
    const resp = await fetch(url, {
      headers: { range: `bytes=${offset}-${end}` },
      signal,
    });
    if (!resp.ok && resp.status !== 206) {
      throw new Error(`Range ${offset}-${end} on ${url} failed: ${resp.status} ${resp.statusText}`);
    }
    const body = resp.body;
    if (body == undefined) {
      // Some environments don't expose a body stream; fall back to
      // arrayBuffer(). Bytes still arrive all-at-once, but at least the
      // call doesn't hang.
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.byteLength !== sizeNum) {
        throw new Error(
          `Range ${offset}-${end} returned ${buf.byteLength} bytes, expected ${sizeNum}`,
        );
      }
      state.buffer.set(buf, 0);
      state.bytesDownloaded = sizeNum;
      state.done = true;
      notifyWaiters(state);
      return;
    }
    const reader = body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (state.bytesDownloaded + value.byteLength > sizeNum) {
        throw new Error(
          `Range ${offset}-${end} returned more bytes than requested (got ${
            state.bytesDownloaded + value.byteLength
          }, expected ≤${sizeNum})`,
        );
      }
      state.buffer.set(value, state.bytesDownloaded);
      state.bytesDownloaded += value.byteLength;
      notifyWaiters(state);
    }
    if (state.bytesDownloaded !== sizeNum) {
      throw new Error(
        `Range ${offset}-${end} truncated: got ${state.bytesDownloaded}, expected ${sizeNum}`,
      );
    }
    state.done = true;
    notifyWaiters(state);
  } catch (err) {
    state.error = err;
    notifyWaiters(state);
  }
}
