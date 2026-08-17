// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { OffscreenCanvasRenderer } from "./OffscreenCanvasRenderer";
import { PlotCoordinator } from "./PlotCoordinator";
import type { CsvDataChunkCallback, IDatasetsBuilder } from "./builders/IDatasetsBuilder";

describe("PlotCoordinator", () => {
  it("uses an accepted custom range batch's exact x bounds as the reset viewport", async () => {
    const update = jest.fn(async () => undefined);
    const renderer = {
      update,
      updateDatasets: jest.fn(async () => undefined),
    } as unknown as OffscreenCanvasRenderer;
    const builder = {
      handlePlayerState: jest.fn(() => undefined),
      setSeries: jest.fn(),
      getViewportDatasets: jest.fn(async () => ({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: new Set<string>(),
      })),
      getCsvData: jest.fn(async () => []),
      forEachCsvDataChunk: jest.fn(async () => true),
    } satisfies IDatasetsBuilder;
    const coordinator = new PlotCoordinator(renderer, builder);

    coordinator.handleRangeDataUpdated({ min: -7.5, max: 42 });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        xBounds: { min: -7.5, max: 42 },
      }),
    );
    coordinator.destroy();
  });

  it("uses a builder's bounded CSV stream without materializing the legacy result", async () => {
    const renderer = {
      update: jest.fn(async () => undefined),
      updateDatasets: jest.fn(async () => undefined),
    } as unknown as OffscreenCanvasRenderer;
    const getCsvData = jest.fn(async () => []);
    const forEachCsvDataChunk = jest.fn(
      async (callback: CsvDataChunkCallback, maxDatums?: number) => {
        expect(maxDatums).toBe(3);
        await callback([
          {
            label: "/foo.val",
            data: [{ x: 0, y: 1, receiveTime: { sec: 0, nsec: 0 }, value: 1 }],
          },
        ]);
        return true;
      },
    );
    const builder = {
      handlePlayerState: jest.fn(() => undefined),
      setSeries: jest.fn(),
      getViewportDatasets: jest.fn(async () => ({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: new Set<string>(),
      })),
      getCsvData,
      forEachCsvDataChunk,
    } satisfies IDatasetsBuilder;
    const coordinator = new PlotCoordinator(renderer, builder);
    const callback = jest.fn(async () => undefined);

    await expect(coordinator.forEachCsvDataChunk(callback, 3)).resolves.toBe(true);

    expect(forEachCsvDataChunk).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({ label: "/foo.val", data: expect.any(Array) }),
    ]);
    expect(getCsvData).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it("refreshes reset bounds when a viewport request reports worker-side x eviction", async () => {
    const update = jest.fn(async () => undefined);
    const builder = {
      handlePlayerState: jest.fn(() => ({ min: 0, max: 100 })),
      setSeries: jest.fn(),
      getViewportDatasets: jest.fn(async () => ({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: new Set<string>(),
        datasetRange: { min: 10, max: 90 },
      })),
      getCsvData: jest.fn(async () => []),
      forEachCsvDataChunk: jest.fn(async () => true),
    } satisfies IDatasetsBuilder;
    const renderer = {
      update,
      updateDatasets: jest.fn(async () => undefined),
    } as unknown as OffscreenCanvasRenderer;
    const coordinator = new PlotCoordinator(renderer, builder);

    coordinator.handleRangeDataUpdated({ min: 0, max: 100 });
    for (let index = 0; index < 3; index++) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ xBounds: { min: 10, max: 90 } }),
    );
    coordinator.destroy();
  });
});
