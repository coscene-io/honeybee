// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CoalescingRemoteReadable } from "./CoalescingRemoteReadable";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CoalescingRemoteReadable", () => {
  it("uses the manifest-provided size without probing the URL with HEAD", async () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const readable = new CoalescingRemoteReadable("https://example.com/shard.mcap", 1024, 4096);

      await readable.open();

      expect(await readable.size()).toBe(4096n);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not abort an in-flight range that still has a waiting read", async () => {
    const firstChunk = deferred<Uint8Array>();
    const secondChunk = deferred<Uint8Array>();
    const abortSignals: AbortSignal[] = [];
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal != undefined) {
        abortSignals.push(signal);
      }

      const chunk = abortSignals.length === 1 ? firstChunk.promise : secondChunk.promise;

      return {
        ok: true,
        status: 206,
        body: {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (signal?.aborted === true) {
                  throw new DOMException("signal is aborted without reason", "AbortError");
                }
                if (sent) {
                  return { done: true, value: undefined };
                }
                sent = true;
                const value = await chunk;
                return { done: false, value };
              },
            };
          },
        },
      };
    }) as jest.MockedFunction<typeof fetch>;

    try {
      const readable = new CoalescingRemoteReadable("https://example.com/shard.mcap", 4, 16);

      const firstRead = readable.read(0n, 4n);
      await Promise.resolve();
      const secondRead = readable.read(8n, 4n);
      await Promise.resolve();

      expect(abortSignals).toHaveLength(2);
      expect(abortSignals[0]?.aborted).toBe(false);

      firstChunk.resolve(new Uint8Array([1, 2, 3, 4]));
      secondChunk.resolve(new Uint8Array([8, 9, 10, 11]));

      await expect(firstRead).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
      await expect(secondRead).resolves.toEqual(new Uint8Array([8, 9, 10, 11]));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
