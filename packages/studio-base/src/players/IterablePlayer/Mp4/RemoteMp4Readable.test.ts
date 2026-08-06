// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FileReader, FileStream } from "@foxglove/studio-base/util/CachedFilelike";

import { RemoteMp4Readable } from "./RemoteMp4Readable";

function mockStream(data: Uint8Array): FileStream {
  const listeners = new Map<string, ((value?: unknown) => void)[]>();
  let destroyed = false;
  const stream = {
    on(event: string, listener: (value?: unknown) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    },
    destroy() {
      destroyed = true;
    },
  } as FileStream;

  queueMicrotask(() => {
    if (destroyed) {
      return;
    }
    for (const listener of listeners.get("data") ?? []) {
      listener(data);
    }
    for (const listener of listeners.get("end") ?? []) {
      listener();
    }
  });
  return stream;
}

class MockFileReader implements FileReader {
  public readonly requests: { offset: number; length: number }[] = [];
  readonly #data: Uint8Array;

  public constructor(size: number) {
    this.#data = Uint8Array.from({ length: size }, (_value, index) => index);
  }

  public async open(): Promise<{ size: number }> {
    return { size: this.#data.byteLength };
  }

  public fetch(offset: number, length: number): FileStream {
    this.requests.push({ offset, length });
    return mockStream(this.#data.slice(offset, offset + length));
  }
}

describe("RemoteMp4Readable", () => {
  it("fetches only the requested range and reuses a containing cached range", async () => {
    const fileReader = new MockFileReader(100);
    const readable = new RemoteMp4Readable("https://example.com/video.mp4", {
      fileReader,
      cacheSizeInBytes: 200,
    });

    expect(await readable.read(10n, 10n)).toEqual(
      Uint8Array.from({ length: 10 }, (_value, index) => index + 10),
    );
    expect(await readable.read(12n, 3n)).toEqual(Uint8Array.of(12, 13, 14));
    expect(fileReader.requests).toEqual([{ offset: 10, length: 10 }]);
  });

  it("evicts least-recently-used ranges when the cache bound is reached", async () => {
    const fileReader = new MockFileReader(100);
    const readable = new RemoteMp4Readable("https://example.com/video.mp4", {
      fileReader,
      cacheSizeInBytes: 5,
    });

    await readable.read(0n, 5n);
    await readable.read(10n, 5n);
    await readable.read(0n, 5n);

    expect(fileReader.requests).toEqual([
      { offset: 0, length: 5 },
      { offset: 10, length: 5 },
      { offset: 0, length: 5 },
    ]);
  });
});
