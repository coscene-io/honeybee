// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

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

export function plotPathDisplayName(path: Readonly<SettingsPlotPath>, index: number): string {
  return presence(path.label) ?? presence(path.value) ?? `Series ${index + 1}`;
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
  // y1 axis
  minY1Value?: string | number;
  maxY1Value?: string | number;
  showY1AxisLabels: boolean;
  y1AxisName?: string;
  showY1Axis: boolean;
  // y2 axis
  minY2Value?: string | number;
  maxY2Value?: string | number;
  showY2AxisLabels: boolean;
  y2AxisName?: string;
  showY2Axis: boolean;
  // y3 axis
  minY3Value?: string | number;
  maxY3Value?: string | number;
  showY3AxisLabels: boolean;
  y3AxisName?: string;
  showY3Axis: boolean;
  // y4 axis
  minY4Value?: string | number;
  maxY4Value?: string | number;
  showY4AxisLabels: boolean;
  y4AxisName?: string;
  showY4Axis: boolean;
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
