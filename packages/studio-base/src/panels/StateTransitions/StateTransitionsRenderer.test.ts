/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";
import type { Theme } from "@mui/material";

import { makeComlinkWorkerMock } from "@foxglove/den/testing";

import { StateTransitionsRenderer } from "./StateTransitionsRenderer";

describe("StateTransitionsRenderer", () => {
  it("reports asynchronous chart RPC failures once and returns safe fallbacks", async () => {
    const failure = new Error("chart RPC failed");
    const remote = {
      async update() {
        throw failure;
      },
      async updateDatasets() {
        throw failure;
      },
      async getElementsAtPixel() {
        throw failure;
      },
      async getDatalabelAtEvent() {
        throw failure;
      },
    };
    const WorkerMock = makeComlinkWorkerMock(() => ({
      async init() {
        return Comlink.proxy(remote);
      },
    }));
    Object.defineProperty(global, "Worker", {
      configurable: true,
      writable: true,
      value: WorkerMock,
    });
    const handleWorkerError = jest.fn();
    const theme = {
      palette: { divider: "#111", text: { secondary: "#222" } },
    } as Theme;
    const renderer = new StateTransitionsRenderer(
      new ArrayBuffer(8) as unknown as OffscreenCanvas,
      theme,
      { handleWorkerError },
    );

    await expect(renderer.update({ type: "update" })).resolves.toBeUndefined();
    await expect(renderer.updateDatasets([])).resolves.toBeUndefined();
    await expect(renderer.getElementsAtPixel({ x: 0, y: 0 })).resolves.toEqual([]);
    await expect(renderer.getDatalabelAtEvent({ x: 0, y: 0 })).resolves.toBeUndefined();

    expect(handleWorkerError).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
    renderer.destroy();
  });
});
