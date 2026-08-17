// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Opaque } from "ts-essentials";

import { MessagePath } from "@foxglove/message-path";
import type { Immutable, Time } from "@foxglove/studio";
import type { Bounds1D } from "@foxglove/studio-base/components/TimeBasedChart/types";
import type { MessageBlock, PlayerState } from "@foxglove/studio-base/players/types";
import { TimestampMethod } from "@foxglove/studio-base/util/time";

import type { Dataset } from "../ChartRenderer";
import { OriginalValue } from "../datum";

export type CsvDatum = {
  x: number;
  y: number;
  receiveTime: Time;
  headerStamp?: Time;
  value: OriginalValue;
};

type Size = { width: number; height: number };

/**
 * Identifier used to determine whether previous data can be reused when the config changes.
 * Compare with deep equality.
 */
export type SeriesConfigKey = Opaque<string, "series-config-key">;

export type SeriesItem = {
  key: SeriesConfigKey;
  /** The original index of this series in config.paths */
  configIndex: number;
  messagePath: string;
  parsed: MessagePath;
  color: string;
  /** Used for points when lines are also shown to provide extra contrast */
  contrastColor: string;
  timestampMethod: TimestampMethod;
  showLine: boolean;
  lineSize: number;
  enabled: boolean;
};

export type Viewport = {
  /**
   * The data bounds of the viewport. The bounds hint which data will be visible to the user. When
   * undefined, assumes that all data is visible in the viewport.
   */
  bounds: {
    x?: Partial<Bounds1D>;
    y?: Partial<Bounds1D>;
  };
  /** The pixel size of the viewport */
  size: Size;
  /**
   * Indicates that the x bounds are advancing as a following time window. Timestamp builders may
   * query and downsample an aligned superset of these bounds so that small playback-head updates
   * can reuse their previous work. The renderer still uses `bounds` as the exact chart scale.
   */
  following?: boolean;
};

export type CsvDataset = {
  label: string;
  data: CsvDatum[];
};

export type CsvDataCursor = {
  /** Index within the enabled series snapshot used by one export operation. */
  seriesIndex: number;
  /** Datum offset within that series. */
  datumIndex: number;
};

export type CsvDataChunk = {
  datasets: CsvDataset[];
  nextCursor?: CsvDataCursor;
};

export type CsvDataChunkCallback = (
  datasets: Immutable<CsvDataset[]>,
) => void | boolean | Promise<void | boolean>;

export const MAX_CSV_DATUMS_PER_CHUNK = 10_000;

export function normalizeCsvChunkSize(maxDatums = MAX_CSV_DATUMS_PER_CHUNK): number {
  if (!Number.isSafeInteger(maxDatums) || maxDatums <= 0) {
    throw new RangeError("CSV chunk size must be a positive safe integer");
  }
  return Math.min(maxDatums, MAX_CSV_DATUMS_PER_CHUNK);
}

/** Streams already-materialized local datasets without exposing more than one bounded chunk. */
export async function forEachCsvDatasetChunk(
  datasets: Immutable<CsvDataset[]>,
  callback: CsvDataChunkCallback,
  maxDatums = MAX_CSV_DATUMS_PER_CHUNK,
): Promise<boolean> {
  const chunkSize = normalizeCsvChunkSize(maxDatums);
  let chunk: CsvDataset[] = [];
  let chunkDatums = 0;

  const flush = async (): Promise<boolean> => {
    if (chunkDatums === 0) {
      return true;
    }
    const current = chunk;
    chunk = [];
    chunkDatums = 0;
    return (await callback(current)) !== false;
  };

  for (const dataset of datasets) {
    for (let offset = 0; offset < dataset.data.length; ) {
      const count = Math.min(chunkSize - chunkDatums, dataset.data.length - offset);
      chunk.push({
        label: dataset.label,
        data: dataset.data.slice(offset, offset + count),
      });
      chunkDatums += count;
      offset += count;
      if (chunkDatums === chunkSize && !(await flush())) {
        return false;
      }
    }
  }

  return await flush();
}

export type GetViewportDatasetsResult = {
  /**
   * Indices correspond to original indices of series in `config.paths`. Array may be sparse if
   * series are invalid (parsing fails) or if they are disabled.
   */
  datasetsByConfigIndex: readonly (Dataset | undefined)[];
  pathsWithMismatchedDataLengths: ReadonlySet<string>;
  /** Authoritative x bounds after worker-side retention or compaction performed by this request. */
  datasetRange?: Bounds1D;
  /**
   * Values at the requested playback time, indexed by the original config path. This remains
   * optional so callers which do not request a playback time keep their existing result shape.
   */
  currentValuesByConfigIndex?: readonly (OriginalValue | undefined)[];
};

/**
 * IDatasetBuilder defines methods for updating the building a dataset.
 *
 * Dataset updates (via new player state, and config) are synchronous and the callers do not expect
 * to wait on any promise. While getting the viewport datasets and csv data are async to allow them
 * to happen on a worker.
 */
interface IDatasetsBuilder {
  handlePlayerState(state: Immutable<PlayerState>): Bounds1D | undefined;

  /**
   * The builder can provide an implementation of this method to handle block data separately from
   * current frame player state data.
   *
   * The method is provided a _progress_ callback to call when there is an opportunity to render
   * some of the processed block data to provide feedback to the caller that work has happened. The
   * progress callback returns false when further processing should stop.
   */
  handleBlocks?(
    startTime: Immutable<Time>,
    blocks: Immutable<(MessageBlock | undefined)[]>,
    progress: () => Promise<boolean>,
  ): Promise<void>;

  setSeries(series: Immutable<SeriesItem[]>): void;

  getViewportDatasets(
    viewport: Immutable<Viewport>,
    currentValuesAt?: Immutable<Time>,
  ): Promise<GetViewportDatasetsResult>;

  getCsvData(): Promise<CsvDataset[]>;

  /** Visit bounded CSV chunks in series order without materializing the complete export. */
  forEachCsvDataChunk(callback: CsvDataChunkCallback, maxDatums?: number): Promise<boolean>;

  /**
   * Optional explicit destroy hook for releasing resources (e.g., workers) immediately
   * instead of relying on GC/FinalizationRegistry.
   */
  destroy?(): void;
}

export type { IDatasetsBuilder };
