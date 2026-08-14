// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import BrowserHttpReader from "@foxglove/studio-base/util/BrowserHttpReader";
import { FileReader } from "@foxglove/studio-base/util/CachedFilelike";

const DEFAULT_CACHE_SIZE_IN_BYTES = 200 * 1024 * 1024;

type CacheEntry = {
  start: number;
  end: number;
  data: Uint8Array;
};

/**
 * An exact-range HTTP reader with a bounded LRU cache. Unlike CachedFilelike, it never starts a
 * background read-ahead request after satisfying a read.
 */
export class RemoteMp4Readable {
  readonly #fileReader: FileReader;
  readonly #cacheSizeInBytes: number;
  readonly #pendingReads = new Map<string, Promise<Uint8Array>>();
  #fileSize?: number;
  #cacheEntries: CacheEntry[] = [];
  #cachedBytes = 0;

  public constructor(
    url: string,
    options: { fileReader?: FileReader; cacheSizeInBytes?: number } = {},
  ) {
    this.#fileReader = options.fileReader ?? new BrowserHttpReader(url);
    this.#cacheSizeInBytes = options.cacheSizeInBytes ?? DEFAULT_CACHE_SIZE_IN_BYTES;
    if (!Number.isSafeInteger(this.#cacheSizeInBytes) || this.#cacheSizeInBytes < 0) {
      throw new Error(`Invalid remote MP4 cache size: ${this.#cacheSizeInBytes}`);
    }
  }

  public async open(): Promise<void> {
    if (this.#fileSize != undefined) {
      return;
    }
    const { size } = await this.#fileReader.open();
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`Invalid remote MP4 file size: ${size}`);
    }
    this.#fileSize = size;
  }

  public async size(): Promise<bigint> {
    await this.open();
    return BigInt(this.#requireFileSize());
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    await this.open();
    if (offset < 0n || size < 0n || offset + size > BigInt(this.#requireFileSize())) {
      throw new Error(`Invalid remote MP4 read: offset ${offset}, size ${size}`);
    }
    if (offset + size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Remote MP4 read is too large: offset ${offset}, size ${size}`);
    }
    if (size === 0n) {
      return new Uint8Array();
    }

    const numberOffset = Number(offset);
    const numberSize = Number(size);
    const cached = this.#getCached(numberOffset, numberSize);
    if (cached) {
      return cached;
    }

    const key = `${numberOffset}:${numberSize}`;
    const existingRead = this.#pendingReads.get(key);
    if (existingRead) {
      return await existingRead;
    }

    const read = this.#fetchRange(numberOffset, numberSize);
    this.#pendingReads.set(key, read);
    try {
      return await read;
    } finally {
      this.#pendingReads.delete(key);
    }
  }

  async #fetchRange(offset: number, size: number): Promise<Uint8Array> {
    return await new Promise((resolve, reject) => {
      const data = new Uint8Array(size);
      const stream = this.#fileReader.fetch(offset, size);
      let bytesRead = 0;
      let settled = false;

      const rejectRead = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        stream.destroy();
        reject(error);
      };

      stream.on("data", (chunk: Uint8Array) => {
        if (settled) {
          return;
        }
        if (bytesRead + chunk.byteLength > size) {
          rejectRead(
            new Error(`Remote MP4 range response exceeded ${size} bytes at offset ${offset}`),
          );
          return;
        }

        data.set(chunk, bytesRead);
        bytesRead += chunk.byteLength;
        if (bytesRead === size) {
          settled = true;
          this.#storeCached(offset, data);
          stream.destroy();
          resolve(data);
        }
      });
      stream.on("end", () => {
        if (!settled) {
          rejectRead(
            new Error(
              `Short remote MP4 range read at offset ${offset}: expected ${size}, got ${bytesRead}`,
            ),
          );
        }
      });
      stream.on("error", rejectRead);
    });
  }

  #getCached(offset: number, size: number): Uint8Array | undefined {
    const end = offset + size;
    for (let index = this.#cacheEntries.length - 1; index >= 0; index--) {
      const entry = this.#cacheEntries[index]!;
      if (entry.start <= offset && entry.end >= end) {
        this.#cacheEntries.splice(index, 1);
        this.#cacheEntries.push(entry);
        return entry.data.subarray(offset - entry.start, end - entry.start);
      }
    }
    return undefined;
  }

  #storeCached(offset: number, data: Uint8Array): void {
    if (data.byteLength > this.#cacheSizeInBytes) {
      return;
    }
    const end = offset + data.byteLength;
    for (let index = this.#cacheEntries.length - 1; index >= 0; index--) {
      const entry = this.#cacheEntries[index]!;
      if (entry.start >= offset && entry.end <= end) {
        this.#cacheEntries.splice(index, 1);
        this.#cachedBytes -= entry.data.byteLength;
      }
    }

    this.#cacheEntries.push({ start: offset, end, data });
    this.#cachedBytes += data.byteLength;
    while (this.#cachedBytes > this.#cacheSizeInBytes) {
      const evicted = this.#cacheEntries.shift();
      if (!evicted) {
        break;
      }
      this.#cachedBytes -= evicted.data.byteLength;
    }
  }

  #requireFileSize(): number {
    if (this.#fileSize == undefined) {
      throw new Error("Remote MP4 reader is not open");
    }
    return this.#fileSize;
  }
}
