/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, renderHook } from "@testing-library/react";

import type { IDataSourceFactory } from "@foxglove/studio-base/context/PlayerSelectionContext";

import { useOpenFile } from "./useOpenFile";

const mockSelectSource = jest.fn();
jest.mock("@foxglove/studio-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ selectSource: mockSelectSource }),
}));

describe("useOpenFile", () => {
  const originalPicker = Object.getOwnPropertyDescriptor(window, "showOpenFilePicker");
  const sources: IDataSourceFactory[] = [
    {
      id: "mcap-local-file",
      type: "file",
      displayName: "MCAP",
      iconName: "OpenFile",
      supportedFileTypes: [".mcap"],
      initialize: jest.fn(),
    },
  ];

  beforeEach(() => {
    mockSelectSource.mockReset();
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
  });

  afterEach(() => {
    if (originalPicker) {
      Object.defineProperty(window, "showOpenFilePicker", originalPicker);
    } else {
      Reflect.deleteProperty(window, "showOpenFilePicker");
    }
  });

  it("opens a File via an input when the secure-context picker is unavailable", async () => {
    const { result } = renderHook(() => useOpenFile(sources));
    const pending = result.current();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe(".mcap");
    const file = new File(["mcap"], "recording.mcap");
    fireEvent.change(input, { target: { files: [file] } });
    await pending;
    expect(mockSelectSource).toHaveBeenCalledWith("mcap-local-file", {
      type: "file",
      files: [file],
    });
    expect(input.isConnected).toBe(false);
  });

  it("cleans up when input selection is cancelled", async () => {
    const { result } = renderHook(() => useOpenFile(sources));
    const pending = result.current();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent(input, new Event("cancel"));
    await pending;
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(false);
  });

  it("retains the native handle flow on supported browsers", async () => {
    const file = new File(["mcap"], "recording.mcap");
    const handle = { getFile: async () => file };
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue([handle]),
    });
    const { result } = renderHook(() => useOpenFile(sources));
    await result.current();
    expect(mockSelectSource).toHaveBeenCalledWith("mcap-local-file", { type: "file", handle });
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
