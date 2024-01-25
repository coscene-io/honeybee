// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useTheme } from "@mui/material";
import { ScaleOptions } from "chart.js";
import { AnnotationOptions } from "chartjs-plugin-annotation";
import { useMemo } from "react";
import { useResizeDetector } from "react-resize-detector";

import { filterMap } from "@foxglove/den/collection";
import TimeBasedChart, {
  ChartDefaultView,
  Props as TimeBasedChartProps,
} from "@foxglove/studio-base/components/CoSceneDeduplicatedTimeBasedChart";
import { getLineColor } from "@foxglove/studio-base/util/plotColors";

import { PlotPath, PlotXAxisVal, isReferenceLinePlotPathType, YAxesInfo } from "./internalTypes";
import { PlotData } from "./plotData";

// A "reference line" plot path is a numeric value. It creates a horizontal line on the plot at the specified value.
function getAnnotationFromReferenceLine(path: PlotPath, index: number): AnnotationOptions {
  const borderColor = getLineColor(path.color, index);
  return {
    type: "line",
    display: true,
    drawTime: "beforeDatasetsDraw",
    scaleID: "y",
    label: { content: path.value, width: "100%", height: "100%" },
    borderColor,
    borderDash: [5, 5],
    borderWidth: 1,
    value: Number.parseFloat(path.value),
  };
}

function getAnnotations(paths: PlotPath[]) {
  return filterMap(paths, (path: PlotPath, index: number) => {
    if (!path.enabled) {
      return undefined;
    } else if (isReferenceLinePlotPathType(path)) {
      return getAnnotationFromReferenceLine(path, index);
    }
    return undefined;
  });
}

type PlotChartProps = {
  isSynced: boolean;
  paths: PlotPath[];
  showXAxisLabels: boolean;
  provider: TimeBasedChartProps["typedProvider"];
  datasetBounds: PlotData["bounds"];
  xAxisVal: PlotXAxisVal;
  xAxisName?: string;
  currentTime?: number;
  eventsTimes?: { time: number; color: string; isHovered: boolean }[];
  defaultView?: ChartDefaultView;
  yAxesInfo: YAxesInfo;
  onClick?: TimeBasedChartProps["onClick"];
};
export default function PlotChart(props: PlotChartProps): JSX.Element {
  const theme = useTheme();
  const {
    currentTime,
    eventsTimes,
    datasetBounds,
    provider,
    defaultView,
    isSynced,
    onClick,
    paths,
    showXAxisLabels,
    xAxisVal,
    xAxisName,
    yAxesInfo,
  } = props;

  const annotations = useMemo(() => getAnnotations(paths), [paths]);

  const yAxes = useMemo((): ScaleOptions<"linear"> => {
    const maxYValue = parseFloat((yAxesInfo.yAxis.maxYValue ?? "").toString());
    const minYValue = parseFloat((yAxesInfo.yAxis.minYValue ?? "").toString());
    const showYAxisLabels = yAxesInfo.yAxis.showYAxisLabels;
    const nameText = yAxesInfo.yAxis.yAxisName;
    const nameDisplay = nameText != undefined && nameText.length > 0;

    const min = isNaN(minYValue) ? undefined : minYValue;
    const max = isNaN(maxYValue) ? undefined : maxYValue;
    return {
      min,
      max,
      ticks: {
        display: showYAxisLabels,
        precision: 3,
      },
      title: {
        display: nameDisplay,
        text: nameText,
      },
      grid: {
        color: theme.palette.divider,
      },
    };
  }, [
    theme.palette.divider,
    yAxesInfo.yAxis.maxYValue,
    yAxesInfo.yAxis.minYValue,
    yAxesInfo.yAxis.showYAxisLabels,
    yAxesInfo.yAxis.yAxisName,
  ]);

  const secondYAxesArray = useMemo((): ScaleOptions<"linear">[] => {
    const yAxesArray: ScaleOptions<"linear">[] = [];

    Object.keys(yAxesInfo).forEach((key) => {
      // Skip the main yAxis
      if (key === "yAxis") {
        return;
      }
      const yAxesKey = key as keyof typeof yAxesInfo;

      const maxYValue = parseFloat((yAxesInfo[yAxesKey].maxYValue ?? "").toString());
      const minYValue = parseFloat((yAxesInfo[yAxesKey].minYValue ?? "").toString());
      const showYAxisLabels = yAxesInfo[yAxesKey].showYAxisLabels;
      const display = yAxesInfo[yAxesKey].showYAxis;
      const nameText = yAxesInfo[yAxesKey].yAxisName;
      const nameDisplay = nameText != undefined && nameText.length > 0;

      const min = isNaN(minYValue) ? undefined : minYValue;
      const max = isNaN(maxYValue) ? undefined : maxYValue;
      yAxesArray.push({
        display,
        min,
        max,
        ticks: {
          display: showYAxisLabels,
          precision: 3,
        },
        title: {
          display: nameDisplay,
          text: nameText,
        },
        position: "right",
        grid: {
          color: theme.palette.divider,
          drawOnChartArea: false,
        },
      });
    });

    return yAxesArray;
  }, [theme.palette.divider, yAxesInfo]);

  const yAxesArray = [yAxes, ...secondYAxesArray];

  // Use a debounce and 0 refresh rate to avoid triggering a resize observation while handling
  // an existing resize observation.
  // https://github.com/maslianok/react-resize-detector/issues/45
  const {
    width,
    height,
    ref: sizeRef,
  } = useResizeDetector({
    refreshRate: 0,
    refreshMode: "debounce",
  });

  return (
    <div style={{ width: "100%", flexGrow: 1, overflow: "hidden", padding: "2px" }} ref={sizeRef}>
      <TimeBasedChart
        key={xAxisVal}
        isSynced={isSynced}
        zoom
        width={width ?? 0}
        height={height ?? 0}
        typedProvider={provider}
        dataBounds={datasetBounds}
        annotations={annotations}
        type="scatter"
        yAxesArray={yAxesArray}
        xAxisIsPlaybackTime={xAxisVal === "timestamp"}
        showXAxisLabels={showXAxisLabels}
        xAxisName={xAxisName}
        currentTime={currentTime}
        eventsTimes={eventsTimes}
        defaultView={defaultView}
        onClick={onClick}
      />
    </div>
  );
}
