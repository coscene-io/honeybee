// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import { MessagePath } from "@foxglove/message-path";
import { toSec, subtract as subtractTime } from "@foxglove/rostime";
import { Immutable, MessageEvent, Time } from "@foxglove/studio";
import { simpleGetMessagePathDataItems } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { Bounds1D } from "@foxglove/studio-base/components/TimeBasedChart/types";
import { MessageBlock, PlayerState } from "@foxglove/studio-base/players/types";
import { TimestampMethod, getTimestampForMessage } from "@foxglove/studio-base/util/time";

import { BlockTopicCursor } from "./BlockTopicCursor";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type {
  DataItem,
  TimestampDatasetsBuilderImpl,
  UpdateDataAction,
} from "./TimestampDatasetsBuilderImpl";
import { getChartValue, isChartValue } from "../datum";
import { MathFunction, mathFunctions } from "../mathFunctions";

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

const emptyPaths = new Set<string>();

type TimestampSeriesItem = {
  config: Immutable<SeriesItem>;
  blockCursor: BlockTopicCursor;
};

/**
 * TimestampDatasetsBuilder builds timeseries datasets.
 *
 * It supports full (preload) data and current frame data. The series datums are extracted from
 * input player states and sent to the worker. The worker accumulates the data and provides
 * downsampled data.
 */
export class TimestampDatasetsBuilder implements IDatasetsBuilder {
  #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>;

  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  #lastSeekTime = 0;

  #series: Immutable<TimestampSeriesItem[]> = [];

  #xAxisMode: "timestamp" | "partialTimestamp";

  public constructor(
    {
      handleWorkerError,
      xAxisMode,
    }: {
      handleWorkerError?: (event: Event) => void;
      xAxisMode: "timestamp" | "partialTimestamp";
    } = { xAxisMode: "timestamp" },
  ) {
    this.#xAxisMode = xAxisMode;
    const worker = new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL("./TimestampDatasetsBuilderImpl.worker", import.meta.url),
    );
    worker.onerror = (event) => {
      handleWorkerError?.(event);
    };
    worker.onmessageerror = (event) => {
      handleWorkerError?.(event);
    };
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>(worker);
    this.#datasetsBuilderRemote = remote;

    registry.register(this, dispose);
  }

  public handlePlayerState(state: Immutable<PlayerState>): Bounds1D | undefined {
    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const didSeek = activeData.lastSeekTime !== this.#lastSeekTime;
    this.#lastSeekTime = activeData.lastSeekTime;

    const msgEvents = activeData.messages;
    if (msgEvents.length > 0) {
      for (const series of this.#series) {
        const mathFn = series.config.parsed.modifier
          ? mathFunctions[series.config.parsed.modifier]
          : undefined;

        if (didSeek) {
          if (this.#xAxisMode === "partialTimestamp") {
            return;
          }
          this.#pendingDispatch.push({
            type: "reset-current",
            series: series.config.key,
          });
        }

        const pathItems = readMessagePathItems(
          msgEvents,
          series.config.parsed,
          series.config.timestampMethod,
          activeData.startTime,
          mathFn,
        );

        this.#pendingDispatch.push({
          type: "append-current",
          series: series.config.key,
          items: pathItems,
        });
      }
    }

    return { min: 0, max: toSec(subtractTime(activeData.endTime, activeData.startTime)) };
  }

  public async handleBlocks(
    startTime: Immutable<Time>,
    blocks: Immutable<(MessageBlock | undefined)[]>,
    progress: () => Promise<boolean>,
  ): Promise<void> {
    // identify if series need resetting because
    for (const series of this.#series) {
      if (series.blockCursor.nextWillReset(blocks)) {
        this.#pendingDispatch.push({
          type: "reset-full",
          series: series.config.key,
        });
      }
    }

    const seriesArr = this.#series;

    // We loop through the series and only process one next block and keep doing this until
    // there are no more updates. This processes the series "in parallel" so that all of them appear
    // to be loading blocks at the same time.
    let done = 0;
    do {
      done = 0;

      for (const series of seriesArr) {
        const mathFn = series.config.parsed.modifier
          ? mathFunctions[series.config.parsed.modifier]
          : undefined;

        const messageEvents = series.blockCursor.next(blocks);
        if (!messageEvents) {
          done += 1;
          continue;
        }

        const pathItems = readMessagePathItems(
          messageEvents,
          series.config.parsed,
          series.config.timestampMethod,
          startTime,
          mathFn,
        );

        if (pathItems.length === 0) {
          continue;
        }

        this.#pendingDispatch.push({
          type: "append-full",
          series: series.config.key,
          items: pathItems,
        });

        const abort = await progress();
        if (abort) {
          return;
        }
      }
    } while (done < seriesArr.length);
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    this.#series = series.map((item) => {
      const existing = this.#series.find((existingItem) => existingItem.config.key === item.key);
      return {
        config: item,
        blockCursor: existing?.blockCursor ?? new BlockTopicCursor(item.parsed.topicName),
      };
    });

    this.#pendingDispatch.push({
      type: "update-series-config",
      seriesItems: series,
    });
  }

  public async getViewportDatasets(
    viewport: Immutable<Viewport>,
  ): Promise<GetViewportDatasetsResult> {
    const dispatch = this.#pendingDispatch;
    if (dispatch.length > 0) {
      this.#pendingDispatch = [];
      await this.#datasetsBuilderRemote.applyActions(dispatch);
    }

    const datasets = await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths: emptyPaths };
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    return await this.#datasetsBuilderRemote.getCsvData();
  }

  public async getXRange(): Promise<Bounds1D | undefined> {
    return await this.#datasetsBuilderRemote.getXRange();
  }
}

function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
  timestampMethod: TimestampMethod,
  startTime: Immutable<Time>,
  mathFunction?: MathFunction,
): DataItem[] {
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      if (!isChartValue(item)) {
        continue;
      }
      const chartValue = getChartValue(item);
      if (chartValue == undefined) {
        continue;
      }

      const headerStamp = getTimestampForMessage(event.message);
      const timestamp = timestampMethod === "receiveTime" ? event.receiveTime : headerStamp;
      if (!timestamp) {
        continue;
      }

      const xValue = toSec(subtractTime(timestamp, startTime));
      const mathModified = mathFunction ? mathFunction(chartValue) : chartValue;
      out.push({
        x: xValue,
        y: mathModified,
        receiveTime: event.receiveTime,
        headerStamp,
        value: mathFunction ? mathModified : item,
      });
    }
  }

  return out;
}
