// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "@foxglove/studio";
import { downloadFiles } from "@foxglove/studio-base/util/download";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

import { CsvDataset } from "./builders/IDatasetsBuilder";
import { PlotXAxisVal } from "./config";

function getCSVRow(label: string, data: CsvDataset["data"][0]) {
  const { x, receiveTime, headerStamp, value } = data;
  const receiveTimeFloat = formatTimeRaw(receiveTime);
  const stampTime = headerStamp ? formatTimeRaw(headerStamp) : "";
  return [x, receiveTimeFloat, stampTime, label, value];
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
  const headLine = [getCSVColName(xAxisVal), "receive time", "header.stamp", "topic", "value"];
  const combinedLines: unknown[][] = [headLine];
  for (const dataset of datasets) {
    for (const datum of dataset.data) {
      combinedLines.push(getCSVRow(dataset.label, datum));
    }
  }
  return combinedLines.join("\n");
}

function downloadCSV(
  filename: string,
  datasets: Immutable<CsvDataset[]>,
  xAxisVal: PlotXAxisVal,
): void {
  const csvData = generateCSV(datasets, xAxisVal);
  const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
  downloadFiles([{ blob, fileName: `${filename}.csv` }]);
}

export { downloadCSV, generateCSV };
