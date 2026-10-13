// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "@foxglove/studio";
import { downloadFiles } from "@foxglove/studio-base/util/download";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

import {
  CsvDataChunkCallback,
  CsvDataset,
  MAX_CSV_DATUMS_PER_CHUNK,
} from "./builders/IDatasetsBuilder";
import { PlotXAxisVal } from "./config";

export type CsvDataChunkSource = (
  callback: CsvDataChunkCallback,
  maxDatums: number,
) => Promise<boolean>;

/**
 * Stops a chunk source promptly when its UI consumer is no longer active. The post-callback check
 * also covers a consumer becoming inactive while formatting the current chunk.
 */
function guardCsvDataChunkSource(
  forEachChunk: CsvDataChunkSource,
  shouldContinue: () => boolean,
): CsvDataChunkSource {
  return async (callback, maxDatums) => {
    if (!shouldContinue()) {
      return false;
    }

    const completed = await forEachChunk(async (datasets) => {
      if (!shouldContinue()) {
        return false;
      }
      const keepGoing = await callback(datasets);
      if (keepGoing === false || !shouldContinue()) {
        return false;
      }
      return true;
    }, maxDatums);

    return completed && shouldContinue();
  };
}

function getCSVRow(label: string, data: CsvDataset["data"][0]) {
  const { x, receiveTime, headerStamp, value } = data;
  const receiveTimeFloat = formatTimeRaw(receiveTime);
  const stampTime = headerStamp ? formatTimeRaw(headerStamp) : "";
  return [x, receiveTimeFloat, stampTime, label, value];
}

function stringifyCSVCell(value: ReturnType<typeof getCSVRow>[number]): string {
  // Array#join used this representation for Time values in the legacy full-export path.
  return typeof value === "object" ? Object.prototype.toString.call(value) : String(value);
}

const getCSVColName = (xAxisVal: PlotXAxisVal): string => {
  switch (xAxisVal) {
    case "custom":
    case "currentCustom":
      return "x value";
    case "index":
      return "index";
    case "timestamp":
    case "partialTimestamp":
      return "elapsed time";
  }
};

function generateCSV(datasets: Immutable<CsvDataset[]>, xAxisVal: PlotXAxisVal): string {
  const header = generateCSVHeader(xAxisVal);
  const rows = generateCSVRows(datasets);
  return rows.length === 0 ? header : `${header}\n${rows}`;
}

function generateCSVHeader(xAxisVal: PlotXAxisVal): string {
  return [getCSVColName(xAxisVal), "receive time", "header.stamp", "topic", "value"].join(",");
}

function generateCSVRows(datasets: Immutable<CsvDataset[]>): string {
  const lines: string[] = [];
  for (const dataset of datasets) {
    for (const datum of dataset.data) {
      lines.push(getCSVRow(dataset.label, datum).map(stringifyCSVCell).join(","));
    }
  }
  return lines.join("\n");
}

async function downloadCSV(
  filename: string,
  xAxisVal: PlotXAxisVal,
  forEachChunk: CsvDataChunkSource,
): Promise<void> {
  const blobParts: BlobPart[] = [generateCSVHeader(xAxisVal)];
  const completed = await forEachChunk((datasets) => {
    const rows = generateCSVRows(datasets);
    if (rows.length > 0) {
      blobParts.push("\n", rows);
    }
  }, MAX_CSV_DATUMS_PER_CHUNK);
  if (!completed) {
    return;
  }
  const blob = new Blob(blobParts, { type: "text/csv;charset=utf-8;" });
  downloadFiles([{ blob, fileName: `${filename}.csv` }]);
}

export { downloadCSV, generateCSV, generateCSVRows, guardCsvDataChunkSource };
