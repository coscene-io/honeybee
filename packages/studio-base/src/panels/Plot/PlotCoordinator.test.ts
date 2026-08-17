// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { OffscreenCanvasRenderer } from "./OffscreenCanvasRenderer";
import { PlotCoordinator } from "./PlotCoordinator";
import type {
  CsvDataChunkCallback,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
} from "./builders/IDatasetsBuilder";
import type { PlotConfig, PlotPath } from "./config";
import { PlayerPresence, PlayerState } from "../../players/types";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error("Timed out waiting for coordinator work");
}

function makePlayerState({
  active = true,
  currentSec = 1,
  lastSeekTime = 1,
  playerId = "player-1",
}: {
  active?: boolean;
  currentSec?: number;
  lastSeekTime?: number;
  playerId?: string;
} = {}): PlayerState {
  return {
    activeData: active
      ? {
          messages: [],
          currentTime: { sec: currentSec, nsec: 0 },
          endTime: { sec: 10, nsec: 0 },
          lastSeekTime,
          topics: [],
          speed: 1,
          isPlaying: false,
          repeatEnabled: false,
          topicStats: new Map(),
          startTime: { sec: 0, nsec: 0 },
          datatypes: new Map(),
          totalBytesReceived: 0,
        }
      : undefined,
    capabilities: [],
    presence: PlayerPresence.PRESENT,
    profile: undefined,
    playerId,
    progress: { fullyLoadedFractionRanges: [] },
  };
}

function makeConfig(paths: PlotPath[] = []): PlotConfig {
  return {
    paths,
    showXAxisLabels: true,
    showYAxisLabels: true,
    showLegend: true,
    legendDisplay: "floating",
    showPlotValuesInLegend: true,
    isSynced: false,
    xAxisVal: "timestamp",
    sidebarDimension: 240,
  };
}

function makeRenderer(): OffscreenCanvasRenderer {
  return {
    update: jest.fn(async () => undefined),
    updateDatasets: jest.fn(async () => undefined),
  } as unknown as OffscreenCanvasRenderer;
}

function makeBuilder(
  getViewportDatasets: IDatasetsBuilder["getViewportDatasets"],
): IDatasetsBuilder {
  return {
    handlePlayerState: jest.fn(() => undefined),
    setSeries: jest.fn(),
    getViewportDatasets,
    getCsvData: jest.fn(async () => []),
    forEachCsvDataChunk: jest.fn(async () => true),
  };
}

const emptyViewportResult = (): GetViewportDatasetsResult => ({
  datasetsByConfigIndex: [],
  pathsWithMismatchedDataLengths: new Set<string>(),
});

describe("PlotCoordinator", () => {
  it("emits worker legend values using original config indexes", async () => {
    const getViewportDatasets = jest.fn(async () => ({
      ...emptyViewportResult(),
      currentValuesByConfigIndex: [undefined, "001.50"],
    }));
    const builder = makeBuilder(getViewportDatasets);
    const setSeries = jest.fn();
    builder.setSeries = setSeries;
    const coordinator = new PlotCoordinator(makeRenderer(), builder);
    const currentValuesChanged = jest.fn();
    coordinator.on("currentValuesChanged", currentValuesChanged);
    coordinator.handleConfig(
      makeConfig([
        { enabled: true, timestampMethod: "receiveTime", value: "42" },
        { enabled: true, timestampMethod: "receiveTime", value: "/foo.val" },
      ]),
      "light",
      {},
    );
    coordinator.handlePlayerState(makePlayerState({ currentSec: 5 }));

    await waitForCondition(() =>
      currentValuesChanged.mock.calls.some(
        ([values]) => (values as readonly unknown[])[1] === "001.50",
      ),
    );

    expect(setSeries).toHaveBeenCalledWith([
      expect.objectContaining({ configIndex: 1, messagePath: "/foo.val" }),
    ]);
    expect(getViewportDatasets).toHaveBeenCalledWith(expect.any(Object), { sec: 5, nsec: 0 });
    expect(currentValuesChanged).toHaveBeenCalledWith([undefined, "001.50"]);
    coordinator.destroy();
  });

  it.each(["seek", "source", "config"] as const)(
    "discards a delayed legend response after a %s epoch change",
    async (change) => {
      const stale = deferred<GetViewportDatasetsResult>();
      const getViewportDatasets = jest
        .fn<
          ReturnType<IDatasetsBuilder["getViewportDatasets"]>,
          Parameters<IDatasetsBuilder["getViewportDatasets"]>
        >()
        .mockImplementationOnce(async () => await stale.promise)
        .mockResolvedValue({
          ...emptyViewportResult(),
          currentValuesByConfigIndex: ["fresh"],
        });
      const builder = makeBuilder(getViewportDatasets);
      const coordinator = new PlotCoordinator(makeRenderer(), builder);
      const values: (readonly unknown[])[] = [];
      coordinator.on("currentValuesChanged", (current) => values.push([...current]));
      coordinator.handleConfig(
        makeConfig([{ enabled: true, timestampMethod: "receiveTime", value: "/foo.val" }]),
        "light",
        {},
      );
      coordinator.handlePlayerState(makePlayerState());
      await waitForCondition(() => getViewportDatasets.mock.calls.length === 1);
      values.length = 0;

      switch (change) {
        case "seek":
          coordinator.handlePlayerState(makePlayerState({ currentSec: 2, lastSeekTime: 2 }));
          break;
        case "source":
          coordinator.handlePlayerState(makePlayerState({ currentSec: 2, playerId: "player-2" }));
          break;
        case "config":
          coordinator.handleConfig(
            makeConfig([{ enabled: true, timestampMethod: "receiveTime", value: "/bar.val" }]),
            "light",
            {},
          );
          break;
      }

      stale.resolve({
        ...emptyViewportResult(),
        currentValuesByConfigIndex: ["stale"],
      });
      await waitForCondition(() => values.some((current) => current[0] === "fresh"));

      expect(values.some((current) => current[0] === "stale")).toBe(false);
      coordinator.destroy();
    },
  );

  it("accepts an in-flight legend response during normal playback and then catches up", async () => {
    const first = deferred<GetViewportDatasetsResult>();
    const getViewportDatasets = jest
      .fn<
        ReturnType<IDatasetsBuilder["getViewportDatasets"]>,
        Parameters<IDatasetsBuilder["getViewportDatasets"]>
      >()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValue({
        ...emptyViewportResult(),
        currentValuesByConfigIndex: ["frame-two"],
      });
    const coordinator = new PlotCoordinator(makeRenderer(), makeBuilder(getViewportDatasets));
    const values: (readonly unknown[])[] = [];
    coordinator.on("currentValuesChanged", (current) => values.push([...current]));
    coordinator.handlePlayerState(makePlayerState({ currentSec: 1 }));
    await waitForCondition(() => getViewportDatasets.mock.calls.length === 1);
    values.length = 0;

    coordinator.handlePlayerState(makePlayerState({ currentSec: 2 }));
    first.resolve({
      ...emptyViewportResult(),
      currentValuesByConfigIndex: ["frame-one"],
    });
    await waitForCondition(() => values.some((current) => current[0] === "frame-two"));

    expect(values.findIndex((current) => current[0] === "frame-one")).toBeGreaterThanOrEqual(0);
    expect(values.findIndex((current) => current[0] === "frame-two")).toBeGreaterThan(
      values.findIndex((current) => current[0] === "frame-one"),
    );
    expect(getViewportDatasets.mock.calls[0]?.[1]).toEqual({ sec: 1, nsec: 0 });
    expect(getViewportDatasets.mock.calls.at(-1)?.[1]).toEqual({ sec: 2, nsec: 0 });
    coordinator.destroy();
  });

  it("forwards an inactive source switch to the builder and keeps the legend cleared", async () => {
    const getViewportDatasets = jest.fn(
      async (_viewport, currentValuesAt): Promise<GetViewportDatasetsResult> => ({
        ...emptyViewportResult(),
        ...(currentValuesAt != undefined ? { currentValuesByConfigIndex: ["old"] } : {}),
      }),
    );
    const builder = makeBuilder(getViewportDatasets);
    const handlePlayerState = jest.fn(() => undefined);
    builder.handlePlayerState = handlePlayerState;
    const coordinator = new PlotCoordinator(makeRenderer(), builder);
    const values: (readonly unknown[])[] = [];
    coordinator.on("currentValuesChanged", (current) => values.push([...current]));
    coordinator.handlePlayerState(makePlayerState());
    await waitForCondition(() => values.some((current) => current[0] === "old"));
    values.length = 0;

    const inactiveState = makePlayerState({ active: false, playerId: "player-2" });
    coordinator.handlePlayerState(inactiveState);
    await waitForCondition(() => getViewportDatasets.mock.calls.length >= 2);

    expect(handlePlayerState).toHaveBeenLastCalledWith(inactiveState);
    expect(getViewportDatasets.mock.calls.at(-1)?.[1]).toBeUndefined();
    expect(values).toContainEqual([]);
    expect(values.some((current) => current[0] === "old")).toBe(false);
    coordinator.destroy();
  });

  it("suppresses a delayed legend result after destroy", async () => {
    const pending = deferred<GetViewportDatasetsResult>();
    const getViewportDatasets = jest.fn(async () => await pending.promise);
    const coordinator = new PlotCoordinator(makeRenderer(), makeBuilder(getViewportDatasets));
    const currentValuesChanged = jest.fn();
    coordinator.on("currentValuesChanged", currentValuesChanged);
    coordinator.handlePlayerState(makePlayerState());
    await waitForCondition(() => getViewportDatasets.mock.calls.length === 1);
    currentValuesChanged.mockClear();

    coordinator.destroy();
    pending.resolve({
      ...emptyViewportResult(),
      currentValuesByConfigIndex: ["late"],
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(currentValuesChanged).not.toHaveBeenCalled();
  });

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
