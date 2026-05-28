// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import {
  DataPlatformInterableSourceConsoleApi,
  DataPlatformIterableSource,
} from "./DataPlatformIterableSource";

function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for predicate"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

function delay(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

describe("DataPlatformIterableSource", () => {
  it("aborts the active getStreams request when the iterator abort signal fires", async () => {
    let getStreamsSignal: AbortSignal | undefined;

    const api: DataPlatformInterableSourceConsoleApi = {
      async topics() {
        return {
          start: "1970-01-01T00:00:00.000Z",
          end: "1970-01-01T00:00:01.000Z",
          metaData: [
            {
              topic: "/json",
              encoding: "json",
              schemaName: "JsonMessage",
              schemaEncoding: "jsonschema",
              schema: new TextEncoder().encode(JSON.stringify({ type: "object" })),
              version: "1",
            },
          ],
        };
      },
      async getStreams({ signal }) {
        getStreamsSignal = signal;
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    };

    const source = new DataPlatformIterableSource({
      api,
      params: { key: "record-id", projectName: "warehouses/w/projects/p" },
      requestWindow: { sec: 1, nsec: 0 },
    });
    await source.initialize();

    const abortController = new AbortController();
    const iterator = source.messageIterator({
      topics: mockTopicSelection("/json"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 0, nsec: 0 },
      consumptionType: "partial",
      abortSignal: abortController.signal,
    } as Parameters<DataPlatformIterableSource["messageIterator"]>[0] & {
      abortSignal: AbortSignal;
    });

    const nextPromise = iterator.next();
    await waitFor(() => getStreamsSignal != undefined);

    abortController.abort();

    expect(getStreamsSignal?.aborted).toBe(true);
    await expect(Promise.race([nextPromise, delay(50)])).resolves.toMatchObject({
      done: true,
    });
  });
});
