// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { McapTypes } from "@mcap/core";

// A no-cache, no-read-ahead IReadable for HTTP-served MCAP files.
//
// honeybee's default RemoteFileReadable wraps the HTTP reader in
// CachedFilelike, which — when the cache (200 MiB) is bigger than the file —
// greedily streams the rest of the file in the background as soon as the
// MCAP reader's footer/summary reads finish. That's fine when there's only
// one big bag, but in the shard-manifest data source we open many small
// shards in parallel and most of them won't be subscribed to. The greedy
// prefetch ends up downloading every active shard in full before the user
// even subscribes.
//
// This reader issues exactly one HTTP range request per read() call. Nothing
// is cached and nothing is fetched ahead of time.
export class BareRemoteReadable implements McapTypes.IReadable {
  #url: string;
  #size?: number;

  public constructor(url: string) {
    this.#url = url;
  }

  public async open(): Promise<void> {
    if (this.#size != undefined) {
      return;
    }
    const resp = await fetch(this.#url, { method: "HEAD" });
    if (!resp.ok) {
      throw new Error(`HEAD ${this.#url} failed: ${resp.status} ${resp.statusText}`);
    }
    const len = resp.headers.get("content-length");
    if (len == undefined) {
      throw new Error(`HEAD ${this.#url} missing Content-Length header`);
    }
    const parsed = Number(len);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`HEAD ${this.#url} invalid Content-Length: ${len}`);
    }
    this.#size = parsed;
  }

  public async size(): Promise<bigint> {
    if (this.#size == undefined) {
      await this.open();
    }
    return BigInt(this.#size!);
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (size === 0n) {
      return new Uint8Array();
    }
    if (offset < 0n || size < 0n) {
      throw new Error(`BareRemoteReadable.read invalid input ${offset} ${size}`);
    }
    if (offset + size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`BareRemoteReadable.read range too large ${offset} ${size}`);
    }
    const end = offset + size - 1n;
    const resp = await fetch(this.#url, {
      headers: { range: `bytes=${offset}-${end}` },
    });
    if (!resp.ok && resp.status !== 206) {
      throw new Error(
        `Range ${offset}-${end} on ${this.#url} failed: ${resp.status} ${resp.statusText}`,
      );
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }
}
