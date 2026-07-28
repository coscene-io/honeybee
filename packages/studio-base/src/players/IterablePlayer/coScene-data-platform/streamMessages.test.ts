// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapStreamReader } from "@mcap/core";

import { loadDecompressHandlers, parseChannel } from "@foxglove/mcap-support";

import { streamMessages } from "./streamMessages";

jest.mock("@mcap/core", () => ({
  McapStreamReader: jest.fn(),
}));

jest.mock("@foxglove/mcap-support", () => ({
  loadDecompressHandlers: jest.fn(),
  parseChannel: jest.fn(),
}));

const mockLoadDecompressHandlers = loadDecompressHandlers as jest.MockedFunction<
  typeof loadDecompressHandlers
>;
const mockParseChannel = parseChannel as jest.MockedFunction<typeof parseChannel>;
const mockMcapStreamReader = McapStreamReader as jest.MockedClass<typeof McapStreamReader>;

type StreamResponse = Awaited<
  ReturnType<Parameters<typeof streamMessages>[0]["api"]["getStreams"]>
>;

function response(
  status: number,
  options?: { body?: ReadableStream; message?: string },
): StreamResponse {
  return {
    status,
    body: options?.body,
    json: async () => ({ message: options?.message }),
  } as StreamResponse;
}

function streamBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
}

describe("streamMessages", () => {
  beforeEach(() => {
    mockLoadDecompressHandlers.mockReset();
    mockLoadDecompressHandlers.mockResolvedValue({});
    mockParseChannel.mockReset();
    mockParseChannel.mockReturnValue({
      deserialize: (data: Uint8Array) => ({ size: data.byteLength }),
    } as ReturnType<typeof parseChannel>);
    mockMcapStreamReader.mockReset();
  });

  it("removes the abort listener when abort happens while loading decompress handlers", async () => {
    const abortController = new AbortController();
    const removeEventListenerSpy = jest.spyOn(abortController.signal, "removeEventListener");
    const getStreams = jest.fn(async () => {
      throw new Error("should not request streams");
    });

    mockLoadDecompressHandlers.mockImplementation(async () => {
      abortController.abort();
      return {};
    });

    const iterator = streamMessages({
      api: { getStreams },
      signal: abortController.signal,
      parsedChannelsByTopic: new Map(),
      params: {
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
        id: "record-id",
        projectName: "warehouses/w/projects/p",
        topics: ["/json"],
      },
    });

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(getStreams).not.toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy.mock.calls[0]?.[0]).toBe("abort");
    expect(removeEventListenerSpy.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });

  it.each([
    {
      name: "getStreams rejects",
      getStreams: jest.fn(async () => {
        throw new Error("request failed");
      }),
      expectedError: "request failed",
    },
    {
      name: "401 response",
      getStreams: jest.fn(async () => response(401)),
      expectedError: "Login expired, please login again",
    },
    {
      name: "404 response",
      getStreams: jest.fn(async () => response(404)),
    },
    {
      name: "non-200 response",
      getStreams: jest.fn(async () => response(500, { message: "backend failed" })),
      expectedError: "backend failed",
    },
    {
      name: "missing response body",
      getStreams: jest.fn(async () => response(200)),
      expectedError: "Unable to stream response body",
    },
  ])(
    "removes the abort listener when $name exits before parsing",
    async ({ getStreams, expectedError }) => {
      const abortController = new AbortController();
      const removeEventListenerSpy = jest.spyOn(abortController.signal, "removeEventListener");

      const iterator = streamMessages({
        api: { getStreams },
        signal: abortController.signal,
        parsedChannelsByTopic: new Map(),
        params: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 0 },
          id: "record-id",
          projectName: "warehouses/w/projects/p",
          topics: ["/json"],
        },
      });

      if (expectedError != undefined) {
        await expect(iterator.next()).rejects.toThrow(expectedError);
      } else {
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
      }

      expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
      expect(removeEventListenerSpy.mock.calls[0]?.[0]).toBe("abort");
      expect(removeEventListenerSpy.mock.calls[0]?.[1]).toEqual(expect.any(Function));
    },
  );

  it("yields within a large mcap chunk when the batch size budget is reached", async () => {
    const records = [
      {
        type: "Schema",
        id: 1,
        name: "JsonMessage",
        encoding: "jsonschema",
        data: new Uint8Array([1]),
      },
      {
        type: "Channel",
        id: 1,
        topic: "/json",
        schemaId: 1,
        messageEncoding: "json",
      },
      ...Array.from({ length: 160 }, (_, index) => ({
        type: "Message",
        channelId: 1,
        logTime: BigInt(index),
        data: new Uint8Array([index]),
      })),
      { type: "DataEnd" },
    ];
    const nextRecord = jest.fn(() => records.shift());
    mockMcapStreamReader.mockImplementation(
      () =>
        ({
          append: jest.fn(),
          nextRecord,
          done: jest.fn(() => true),
        }) as unknown as InstanceType<typeof McapStreamReader>,
    );
    const getStreams = jest.fn(async () => response(200, { body: streamBody() }));

    const iterator = streamMessages({
      api: { getStreams },
      parsedChannelsByTopic: new Map(),
      params: {
        start: { sec: 0, nsec: 0 },
        end: { sec: 1, nsec: 0 },
        id: "record-id",
        projectName: "warehouses/w/projects/p",
        topics: ["/json"],
      },
    });

    const firstResult = await iterator.next();
    expect(firstResult.done).toBe(false);
    if (firstResult.done !== false) {
      throw new Error("Expected the first stream result to contain messages");
    }
    expect(firstResult.value).toHaveLength(128);

    const secondResult = await iterator.next();
    expect(secondResult.done).toBe(false);
    if (secondResult.done !== false) {
      throw new Error("Expected the second stream result to contain messages");
    }
    expect(secondResult.value).toHaveLength(32);
  });
});
