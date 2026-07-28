// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import {
  DataPlatformInterableSourceConsoleApi,
  DataPlatformIterableSource,
} from "./DataPlatformIterableSource";

async function delay(ms: number): Promise<"timeout"> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
  return "timeout";
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }
  expect(predicate()).toBe(true);
}

describe("DataPlatformIterableSource", () => {
  function makeApi(
    getStreams: DataPlatformInterableSourceConsoleApi["getStreams"],
  ): DataPlatformInterableSourceConsoleApi {
    return {
      async topics() {
        return {
          start: "1970-01-01T00:00:00.000Z",
          end: "1970-01-01T00:00:03.000Z",
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
      getStreams,
    };
  }

  it("aborts the active getStreams request when the iterator abort signal fires", async () => {
    let getStreamsSignal: AbortSignal | undefined;

    const api = makeApi(async ({ signal }) => {
      getStreamsSignal = signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });

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
    });

    const nextPromise = iterator.next();
    await waitFor(() => getStreamsSignal != undefined);

    abortController.abort();

    expect(getStreamsSignal?.aborted).toBe(true);
    await expect(race([nextPromise, delay(50)])).resolves.toMatchObject({
      done: true,
    });
  });

  it("does not request the next partial window after the iterator abort signal fires", async () => {
    const abortController = new AbortController();
    const getStreams = jest.fn(async ({ signal }) => {
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
        abortController.abort();
        if (signal.aborted === true) {
          reject(new DOMException("Aborted", "AbortError"));
        }
      });
    });
    const source = new DataPlatformIterableSource({
      api: makeApi(getStreams),
      params: { key: "record-id", projectName: "warehouses/w/projects/p" },
      requestWindow: { sec: 1, nsec: 0 },
    });
    await source.initialize();

    const iterator = source.messageIterator({
      topics: mockTopicSelection("/json"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 3, nsec: 0 },
      consumptionType: "partial",
      abortSignal: abortController.signal,
    });

    await expect(race([iterator.next(), delay(50)])).resolves.toEqual({ done: true });
    expect(getStreams).toHaveBeenCalledTimes(1);
    expect(getStreams.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it("does not request streams when the iterator abort signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const getStreams = jest.fn(async () => {
      throw new Error("should not request streams");
    });
    const source = new DataPlatformIterableSource({
      api: makeApi(getStreams),
      params: { key: "record-id", projectName: "warehouses/w/projects/p" },
      requestWindow: { sec: 1, nsec: 0 },
    });
    await source.initialize();

    const iterator = source.messageIterator({
      topics: mockTopicSelection("/json"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 3, nsec: 0 },
      consumptionType: "partial",
      abortSignal: abortController.signal,
    });

    await expect(iterator.next()).resolves.toEqual({ done: true });
    expect(getStreams).not.toHaveBeenCalled();
  });
});
