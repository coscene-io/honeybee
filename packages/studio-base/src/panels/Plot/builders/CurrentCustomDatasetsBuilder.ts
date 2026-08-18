// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ChartDataset } from "chart.js";
import * as _ from "lodash-es";

import { filterMap } from "@foxglove/den/collection";
import { MessagePath } from "@foxglove/message-path";
import { Immutable, Time, MessageEvent } from "@foxglove/studio";
import { simpleGetMessagePathDataItems } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { PlayerState } from "@foxglove/studio-base/players/types";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";

import {
  CsvDataChunkCallback,
  CsvDataset,
  forEachCsvDatasetChunk,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
  MAX_CSV_DATUMS_PER_CHUNK,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import { Dataset } from "../ChartRenderer";
import { getChartValue, isChartValue, toOwnedChartValue, Datum } from "../datum";
import { mathFunctions } from "../mathFunctions";

type DatumWithReceiveTime = Datum & {
  receiveTime: Time;
};

type CurrentCustomSeriesItem = {
  configIndex: number;
  enabled: boolean;
  messagePath: string;
  parsed: Immutable<MessagePath>;
  dataset: ChartDataset<"scatter", DatumWithReceiveTime[]>;
  legendValue?: Datum["value"];
};

/**
 * CurrentCustomDatasetsBuilder builds datasets from a custom x-axis message path and
 * y-axis message path. It uses only the latest message for each path to build the datasets.
 */
export class CurrentCustomDatasetsBuilder implements IDatasetsBuilder {
  #xParsedPath?: Immutable<MessagePath>;

  #xValues: number[] = [];

  #seriesByKey = new Map<SeriesConfigKey, CurrentCustomSeriesItem>();
  #pathsWithMismatchedDataLengths = new Set<string>();
  #lastSeekTime = NaN;
  #playerId?: string;

  // Process the latest messages from the player state to extract any updated x or y values
  //
  // Datasets are built when y-values arrive though this could be expanded to also build
  // when x-values arrive.
  public handlePlayerState(state: Immutable<PlayerState>): Bounds1D | undefined {
    const sourceChanged = this.#playerId != undefined && this.#playerId !== state.playerId;
    this.#playerId = state.playerId;
    if (sourceChanged) {
      this.#clearLatestData();
    }
    const activeData = state.activeData;
    if (!activeData) {
      this.#clearLegendValues();
      return;
    }

    if (!sourceChanged && activeData.lastSeekTime !== this.#lastSeekTime) {
      this.#clearLatestData();
    }
    if (sourceChanged || activeData.lastSeekTime !== this.#lastSeekTime) {
      this.#lastSeekTime = activeData.lastSeekTime;
    }
    if (!this.#xParsedPath) {
      return;
    }

    const msgEvents = activeData.messages;
    if (msgEvents.length === 0) {
      return;
    }

    {
      const xAxisMathFn =
        (this.#xParsedPath.modifier ? mathFunctions[this.#xParsedPath.modifier] : undefined) ??
        _.identity<number>;

      const msgEvent = lastMatchingTopic(msgEvents, this.#xParsedPath.topicName);
      if (msgEvent) {
        const items = simpleGetMessagePathDataItems(msgEvent, this.#xParsedPath);

        this.#xValues = [];
        for (const item of items) {
          if (!isChartValue(item)) {
            continue;
          }

          const chartValue = getChartValue(item);
          if (chartValue == undefined) {
            continue;
          }

          this.#xValues.push(xAxisMathFn(chartValue));
        }
      }
    }

    for (const series of this.#seriesByKey.values()) {
      const mathFn = series.parsed.modifier ? mathFunctions[series.parsed.modifier] : undefined;

      const legendMatch = lastNonEmptyPathMatch(msgEvents, series.parsed);
      if (legendMatch) {
        series.legendValue = lastChartValue(legendMatch, mathFn);
      }

      const msgEvent = lastMatchingTopic(msgEvents, series.parsed.topicName);
      if (!msgEvent) {
        continue;
      }

      const items = simpleGetMessagePathDataItems(msgEvent, series.parsed);
      const pathItems = filterMap(items, (item, idx) => {
        if (!isChartValue(item)) {
          return;
        }

        const chartValue = getChartValue(item);
        const mathModifiedValue =
          mathFn && chartValue != undefined ? mathFn(chartValue) : undefined;

        return {
          x: this.#xValues[idx] ?? NaN,
          y: chartValue == undefined ? NaN : (mathModifiedValue ?? chartValue),
          receiveTime: msgEvent.receiveTime,
          value: mathModifiedValue ?? toOwnedChartValue(item),
        };
      });

      if (pathItems.length === this.#xValues.length) {
        this.#pathsWithMismatchedDataLengths.delete(series.messagePath);
      } else {
        this.#pathsWithMismatchedDataLengths.add(series.messagePath);
      }

      series.dataset.data = pathItems;
    }

    // Returning undefined means we allow the chart to determine the bounds and don't need to
    // provide the dataset bounds.
    return undefined;
  }

  #clearLatestData(): void {
    this.#xValues = [];
    this.#pathsWithMismatchedDataLengths.clear();
    for (const series of this.#seriesByKey.values()) {
      series.dataset.data = [];
    }
    this.#clearLegendValues();
  }

  #clearLegendValues(): void {
    for (const series of this.#seriesByKey.values()) {
      series.legendValue = undefined;
    }
  }

  public setXPath(path: Immutable<MessagePath> | undefined): void {
    if (JSON.stringify(path) === JSON.stringify(this.#xParsedPath)) {
      return;
    }

    // When the x-path changes we clear any existing data from the datasets
    this.#xParsedPath = path;
    for (const series of this.#seriesByKey.values()) {
      series.dataset.data = [];
    }
    this.#pathsWithMismatchedDataLengths.clear();
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    // Make a new map so we drop series which are no longer present
    const newSeries = new Map();

    for (const item of series) {
      let existingSeries = this.#seriesByKey.get(item.key);
      existingSeries ??= {
        configIndex: item.configIndex,
        enabled: item.enabled,
        messagePath: item.messagePath,
        parsed: item.parsed,
        dataset: {
          data: [],
        },
      };

      existingSeries.configIndex = item.configIndex;
      existingSeries.enabled = item.enabled;
      existingSeries.dataset = {
        ...existingSeries.dataset,
        borderColor: item.color,
        showLine: item.showLine,
        fill: false,
        borderWidth: item.lineSize,
        pointRadius: item.lineSize * 1.2,
        pointHoverRadius: 3,
        pointBackgroundColor: item.showLine ? item.contrastColor : item.color,
        pointBorderColor: "transparent",
      };

      newSeries.set(item.key, existingSeries);
    }
    this.#seriesByKey = newSeries;
  }

  // We don't use the viewport because we do not do any downsampling on the assumption that
  // one message won't produce so many points that we need to downsample.
  //
  // If that assumption changes then downsampling can be revisited.
  public async getViewportDatasets(
    _viewport?: Immutable<Viewport>,
    currentValuesAt?: Immutable<Time>,
  ): Promise<GetViewportDatasetsResult> {
    const datasets: Dataset[] = [];
    const currentValuesByConfigIndex: Array<Datum["value"] | undefined> = [];
    for (const series of this.#seriesByKey.values()) {
      if (series.enabled) {
        datasets[series.configIndex] = series.dataset;
        if (currentValuesAt != undefined) {
          currentValuesByConfigIndex[series.configIndex] = series.legendValue;
        }
      }
    }

    return {
      datasetsByConfigIndex: datasets,
      pathsWithMismatchedDataLengths: this.#pathsWithMismatchedDataLengths,
      ...(currentValuesAt != undefined ? { currentValuesByConfigIndex } : {}),
    };
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.enabled) {
        continue;
      }

      datasets.push({
        label: series.messagePath,
        data: series.dataset.data,
      });
    }

    return datasets;
  }

  public async forEachCsvDataChunk(
    callback: CsvDataChunkCallback,
    maxDatums = MAX_CSV_DATUMS_PER_CHUNK,
  ): Promise<boolean> {
    return await forEachCsvDatasetChunk(await this.getCsvData(), callback, maxDatums);
  }
}

function lastNonEmptyPathMatch(
  msgEvents: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
): unknown[] | undefined {
  for (let i = msgEvents.length - 1; i >= 0; --i) {
    const msgEvent = msgEvents[i]!;
    if (msgEvent.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(msgEvent, path);
    if (items.length > 0) {
      return items;
    }
  }

  return undefined;
}

function lastMatchingTopic(msgEvents: Immutable<MessageEvent[]>, topic: string) {
  for (let i = msgEvents.length - 1; i >= 0; --i) {
    const msgEvent = msgEvents[i]!;
    if (msgEvent.topic === topic) {
      return msgEvent;
    }
  }

  return undefined;
}

function lastChartValue(
  items: readonly unknown[],
  mathFn: ((value: number) => number) | undefined,
): Datum["value"] | undefined {
  for (let i = items.length - 1; i >= 0; --i) {
    const item = items[i];
    if (!isChartValue(item)) {
      continue;
    }

    const chartValue = getChartValue(item);
    const mathModifiedValue = mathFn && chartValue != undefined ? mathFn(chartValue) : undefined;
    return mathModifiedValue ?? item;
  }

  return undefined;
}
