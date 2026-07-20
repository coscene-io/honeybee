// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";

import { markRealtimeCacheForCleanup } from "./PlayerManager";

jest.mock("@foxglove/studio-base/persistence/IndexedDbMessageStore", () => ({
  IndexedDbMessageStore: jest.fn(),
}));

const MockIndexedDbMessageStore = jest.mocked(IndexedDbMessageStore);
const mockInit = jest.fn();
const mockDiscardAndSeal = jest.fn();
const mockClose = jest.fn();
const mockClear = jest.fn();
const mockCleanupOldSessions = jest.fn();

describe("markRealtimeCacheForCleanup", () => {
  beforeEach(() => {
    MockIndexedDbMessageStore.mockReset();
    mockInit.mockReset().mockResolvedValue(undefined);
    mockDiscardAndSeal.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockClear.mockReset();
    mockCleanupOldSessions.mockReset();
    MockIndexedDbMessageStore.mockImplementation(
      () =>
        ({
          init: mockInit,
          discardAndSeal: mockDiscardAndSeal,
          close: mockClose,
          clear: mockClear,
          cleanupOldSessions: mockCleanupOldSessions,
        }) as unknown as IndexedDbMessageStore,
    );
  });

  it("does not create an empty session when there is no previous session", async () => {
    await markRealtimeCacheForCleanup();

    expect(MockIndexedDbMessageStore).not.toHaveBeenCalled();
  });

  it("seals the previous session for janitor cleanup without deleting data inline", async () => {
    await markRealtimeCacheForCleanup("previous-session");

    expect(MockIndexedDbMessageStore).toHaveBeenCalledWith({
      sessionId: "previous-session",
      kind: "realtime-viz",
    });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockDiscardAndSeal).toHaveBeenCalledWith("pending-delete");
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockCleanupOldSessions).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("contains maintenance failures", async () => {
    mockDiscardAndSeal.mockRejectedValueOnce(new Error("IndexedDB unavailable"));

    await expect(markRealtimeCacheForCleanup("previous-session")).resolves.toBeUndefined();

    expect(mockDiscardAndSeal).toHaveBeenCalledWith("pending-delete");
    expect(mockClose).toHaveBeenCalledTimes(1);
    jest.mocked(console.warn).mockClear();
  });
});
