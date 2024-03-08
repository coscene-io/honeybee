// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";

import { PANEL_TITLE_CONFIG_KEY } from "@foxglove/studio-base/util/layout";

import type { BasePlotPath, SettingsPlotPath, PlotXAxisVal } from "./internalTypes";

/**
 * Coalesces null, undefined and empty string to undefined.
 */
function presence<T>(value: undefined | T): undefined | T {
  if (value === "") {
    return undefined;
  }

  return value ?? undefined;
}

export function plotPathDisplayName(
  path: Readonly<SettingsPlotPath>,
  index: number,
  t: TFunction<"plot">,
): string {
  return presence(path.label) ?? presence(path.value) ?? `${t("series")} ${index + 1}`;
}

type DeprecatedPlotConfig = {
  showSidebar?: boolean;
  sidebarWidth?: number;
};

export type PlotConfig = DeprecatedPlotConfig & {
  /** @deprecated Replaced by global panel rename functionality https://github.com/foxglove/studio/pull/5225 */
  title?: string;
  paths: SettingsPlotPath[];
  minXValue?: number;
  maxXValue?: number;
  showLegend: boolean;
  legendDisplay: "floating" | "top" | "left" | "none";
  showPlotValuesInLegend: boolean;
  showXAxisLabels: boolean;
  isSynced: boolean;
  xAxisVal: PlotXAxisVal;
  xAxisPath?: BasePlotPath;
  xAxisName?: string;
  followingViewWidth?: number;
  sidebarDimension: number;
  [PANEL_TITLE_CONFIG_KEY]?: string;
  showMoments: boolean;
  momentsFilter?: string;
  selectRecords: string[];
  // y axis
  minYValue?: string | number;
  maxYValue?: string | number;
  showYAxisLabels: boolean;
  yAxisName?: string;
  yMultiplicationFactor: number;
  // y1 axis
  minY1Value?: string | number;
  maxY1Value?: string | number;
  showY1AxisLabels: boolean;
  y1AxisName?: string;
  showY1Axis: boolean;
  y1MultiplicationFactor: number;
  // y2 axis
  minY2Value?: string | number;
  maxY2Value?: string | number;
  showY2AxisLabels: boolean;
  y2AxisName?: string;
  showY2Axis: boolean;
  y2MultiplicationFactor: number;
};

export const plotableRosTypes = [
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
  "time",
  "duration",
  "string",
];
