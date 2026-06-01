// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { loadDecompressHandlers } from "@foxglove/mcap-support";

import { streamMessages } from "./streamMessages";

jest.mock("@foxglove/mcap-support", () => ({
  loadDecompressHandlers: jest.fn(),
  parseChannel: jest.fn(),
}));

const mockLoadDecompressHandlers = loadDecompressHandlers as jest.MockedFunction<
  typeof loadDecompressHandlers
>;

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

describe("streamMessages", () => {
  beforeEach(() => {
    mockLoadDecompressHandlers.mockReset();
    mockLoadDecompressHandlers.mockResolvedValue({});
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
});
