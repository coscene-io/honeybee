// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

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
import * as _ from "lodash-es";
import { ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { useDeepMemo } from "@foxglove/hooks";
import {
  Time,
  add as addTimes,
  fromSec,
  subtract as subtractTimes,
  toSec,
} from "@foxglove/rostime";
import { ChartDefaultView } from "@foxglove/studio-base/components/CoSceneDeduplicatedTimeBasedChart";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import {
  PanelContextMenu,
  PanelContextMenuItem,
} from "@foxglove/studio-base/components/PanelContextMenu";
import PanelToolbar, {
  PANEL_TOOLBAR_MIN_HEIGHT,
} from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import { useEvents, EventsStore } from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useTopicPrefixConfigurationValue } from "@foxglove/studio-base/hooks";
import { OnClickArg as OnChartClickArgs } from "@foxglove/studio-base/src/components/Chart";
import { OpenSiblingPanel, PanelConfig, SaveConfig } from "@foxglove/studio-base/types/panels";
import { PANEL_TITLE_CONFIG_KEY } from "@foxglove/studio-base/util/layout";

import MomentsList from "./MomentsList";
import PlotChart from "./PlotChart";
import { PlotLegend } from "./PlotLegend";
import { downloadCSV } from "./csv";
import { PlotPath, TypedDataSet, YAxesInfo } from "./internalTypes";
import { EmptyPlotData, EmptyData } from "./plotData";
import { usePlotPanelSettings } from "./settings";
import { PlotConfig } from "./types";
import useDatasets from "./useDatasets";

export { plotableRosTypes } from "./types";
export type { PlotConfig } from "./types";

const defaultSidebarDimension = 240;

const EmptyDatasets: TypedDataSet[] = [];

export function openSiblingPlotPanel(openSiblingPanel: OpenSiblingPanel, topicName: string): void {
  openSiblingPanel({
    panelType: "Plot",
    updateIfExists: true,
    siblingConfigCreator: (config: PanelConfig) => ({
      ...config,
      paths: _.uniq(
        (config as PlotConfig).paths
          .concat([{ value: topicName, yAxisID: "yAxis", lines: [], multiplicationFactor: 1 }])
          .filter(({ value }) => value),
      ),
    }),
  });
}

type Props = {
  config: PlotConfig;
  saveConfig: SaveConfig<PlotConfig>;
};

function selectStartTime(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData?.startTime;
}

function selectCurrentTime(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData?.currentTime;
}

function selectEndTime(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData?.endTime;
}

const ZERO_TIME = Object.freeze({ sec: 0, nsec: 0 });

const selectEvents = (store: EventsStore) => store.events;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectLoopedEvent = (store: TimelineInteractionStateStore) => store.loopedEvent;

function Plot(props: Props) {
  const { saveConfig, config } = props;
  const { t } = useTranslation("cosAnnotatedPlot");
  const {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    title: legacyTitle,
    followingViewWidth,
    paths: originalPaths,
    minXValue,
    maxXValue,
    showXAxisLabels,
    showLegend,
    legendDisplay = config.showSidebar === true ? "left" : "floating",
    showPlotValuesInLegend,
    isSynced,
    xAxisVal,
    xAxisPath,
    sidebarDimension = config.sidebarWidth ?? defaultSidebarDimension,
    [PANEL_TITLE_CONFIG_KEY]: customTitle,
    showMoments,
    momentsFilter,
    selectRecords,
    xAxisName,
    yMultiplicationFactor,
    y1MultiplicationFactor,
    y2MultiplicationFactor,
  } = config;
  const addTopicPrefix = useTopicPrefixConfigurationValue();

  const yAxesInfo: YAxesInfo = {
    yAxis: {
      minYValue: config.minYValue,
      maxYValue: config.maxYValue,
      showYAxisLabels: config.showYAxisLabels,
      yAxisName: config.yAxisName,
    },
    y1Axis: {
      minYValue: config.minY1Value,
      maxYValue: config.maxY1Value,
      showYAxisLabels: config.showY1AxisLabels,
      yAxisName: config.y1AxisName,
      showYAxis: config.showY1Axis,
    },
    y2Axis: {
      minYValue: config.minY2Value,
      maxYValue: config.maxY2Value,
      showYAxisLabels: config.showY2AxisLabels,
      yAxisName: config.y2AxisName,
      showYAxis: config.showY2Axis,
    },
  };

  const multiplicationFactorMap: Record<string, number> = useMemo(
    () => ({
      y: yMultiplicationFactor,
      y1: y1MultiplicationFactor,
      y2: y2MultiplicationFactor,
    }),
    [y1MultiplicationFactor, y2MultiplicationFactor, yMultiplicationFactor],
  );

  const yAxisPaths = useMemo(() => {
    const linePaths: PlotPath[] = [];
    originalPaths.forEach((path) => {
      path.lines.forEach((line) => {
        linePaths.push({
          value: line.value,
          enabled: line.enabled,
          color: line.color,
          label: line.label,
          timestampMethod: line.timestampMethod,
          showLine: line.showLine,
          lineSize: line.lineSize,
          yAxisID: path.yAxisID,
          multiplicationFactor: multiplicationFactorMap[path.yAxisID] ?? 1,
        });
      });
    });

    return linePaths;
  }, [multiplicationFactorMap, originalPaths]);

  const events = useEvents(selectEvents);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);

  const { setMessagePathDropConfig } = usePanelContext();

  useEffect(() => {
    if (addTopicPrefix !== "true") {
      toast.error(t("prefixTip"));
    }
  }, [addTopicPrefix, t]);

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus() {
        return { canDrop: false };
      },
      handleDrop() {},
    });
  }, [saveConfig, setMessagePathDropConfig]);

  useEffect(() => {
    if (legacyTitle && (customTitle == undefined || customTitle === "")) {
      // Migrate legacy Plot-specific title setting to new global title setting
      // https://github.com/foxglove/studio/pull/5225
      saveConfig({
        title: undefined,
        [PANEL_TITLE_CONFIG_KEY]: legacyTitle,
      } as Partial<PlotConfig>);
    }
  }, [customTitle, legacyTitle, saveConfig]);

  const startTime = useMessagePipeline(selectStartTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const endTime = useMessagePipeline(selectEndTime);

  // Min/max x-values and playback position indicator are only used for preloaded plots. In non-
  // preloaded plots min x-value is always the last seek time, and the max x-value is the current
  // playback time.
  const timeSincePreloadedStart = (time?: Time): number | undefined => {
    if (xAxisVal === "timestamp" && time && startTime) {
      return toSec(subtractTimes(time, startTime));
    }
    return undefined;
  };

  const currentTimeSinceStart = timeSincePreloadedStart(currentTime);

  const filteredEvents = useMemo(() => {
    if (!showMoments) {
      return [];
    }
    if (selectRecords.length === 0 && (momentsFilter == undefined || momentsFilter === "")) {
      return events.value ?? [];
    }
    return (events.value ?? [])
      .filter((event) => {
        return selectRecords.length === 0 || selectRecords.includes(event.event.record);
      })
      .filter((event) => {
        const eventString =
          event.event.displayName +
          event.event.description +
          Object.entries(event.event.customizedFields)
            .map(([key, value]) => `${key}${value}`)
            .join("");
        return (
          momentsFilter == undefined || momentsFilter === "" || eventString.includes(momentsFilter)
        );
      });
  }, [events, momentsFilter, showMoments, selectRecords]);

  const eventsTimeSinceStart = filteredEvents.map((event) => {
    const isHovered =
      (hoveredEvent != undefined && event.event.name === hoveredEvent.event.name) ||
      eventsAtHoverValue[event.event.name] != undefined ||
      loopedEvent?.event.name === event.event.name;

    return {
      time: timeSincePreloadedStart(event.startTime) ?? 0,
      color: event.color,
      isHovered,
    };
  });

  const followingView = useMemo<ChartDefaultView | undefined>(() => {
    if (followingViewWidth != undefined && +followingViewWidth > 0) {
      return { type: "following", width: +followingViewWidth };
    }
    return undefined;
  }, [followingViewWidth]);

  const endTimeSinceStart = timeSincePreloadedStart(endTime);
  const fixedView = useMemo<ChartDefaultView | undefined>(() => {
    // Apply min/max x-value if either min or max or both is defined.
    if ((_.isNumber(minXValue) && _.isNumber(endTimeSinceStart)) || _.isNumber(maxXValue)) {
      return {
        type: "fixed",
        minXValue: _.isNumber(minXValue) ? minXValue : 0,
        maxXValue: _.isNumber(maxXValue) ? maxXValue : endTimeSinceStart ?? 0,
      };
    }
    if (xAxisVal === "timestamp" && startTime && endTimeSinceStart != undefined) {
      return { type: "fixed", minXValue: 0, maxXValue: endTimeSinceStart };
    }
    return undefined;
  }, [maxXValue, minXValue, endTimeSinceStart, startTime, xAxisVal]);

  // following view and fixed view are split to keep defaultView identity stable when possible
  const defaultView = useMemo<ChartDefaultView | undefined>(() => {
    return followingView ?? fixedView ?? undefined;
  }, [fixedView, followingView]);

  const theme = useTheme();

  const yAxesParams = _.cloneDeep(yAxesInfo);

  Object.keys(yAxesParams).forEach((key) => {
    const yAxesInfoKey = key as keyof YAxesInfo;
    // Delete the yAxisName property from each sub-object
    delete yAxesParams[yAxesInfoKey].yAxisName;
    delete yAxesParams[yAxesInfoKey].showYAxis;
  });

  // 与页面展示无关，利用 worker 计算图表中的数据
  const {
    data: plotData,
    provider,
    getFullData,
  } = useDatasets({
    startTime: startTime ?? ZERO_TIME,
    paths: yAxisPaths,
    invertedTheme: theme.palette.mode === "dark",
    xAxisPath,
    xAxisVal,
    minXValue,
    maxXValue,
    yAxesInfo: yAxesParams,
    followingViewWidth,
  });

  const {
    datasets,
    bounds: datasetBounds,
    pathsWithMismatchedDataLengths,
  } = useMemo(() => {
    const data = plotData ?? EmptyPlotData;
    return {
      bounds: data.bounds,
      pathsWithMismatchedDataLengths: data.pathsWithMismatchedDataLengths,
      // Return a dataset for all paths here so that the ordering of datasets corresponds
      // to yAxisPaths as expected by downstream components like the legend.
      //
      // Label is needed so that TimeBasedChart doesn't discard the empty dataset and mess
      // up the ordering.
      datasets: yAxisPaths.map((path) => {
        for (const [otherPath, dataset] of data.datasets.entries()) {
          if (
            otherPath.value === path.value &&
            otherPath.timestampMethod === path.timestampMethod
          ) {
            return dataset;
          }
        }
        return { label: path.label ?? path.value, data: [EmptyData] };
      }),
    };
  }, [plotData, yAxisPaths]);

  // We use a deep memo here as React's default equality check Object.is() returns false for
  // two empty lists which causes unnecessary re-rendering of the PlotLegend component.
  const memoizedPathsWithMismatchedDataLengths = useDeepMemo(pathsWithMismatchedDataLengths);

  const messagePipeline = useMessagePipelineGetter();
  const onClick = useCallback<NonNullable<ComponentProps<typeof PlotChart>["onClick"]>>(
    ({ x: seekSeconds }: OnChartClickArgs) => {
      const {
        seekPlayback,
        playerState: { activeData: { startTime: start } = {} },
      } = messagePipeline();
      if (!seekPlayback || !start || seekSeconds == undefined || xAxisVal !== "timestamp") {
        return;
      }
      // Avoid normalizing a negative time if the clicked point had x < 0.
      if (seekSeconds >= 0) {
        seekPlayback(addTimes(start, fromSec(seekSeconds)));
      }
    },
    [messagePipeline, xAxisVal],
  );

  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);

  usePlotPanelSettings(config, saveConfig, focusedPath);

  const stackDirection = useMemo(
    () => (legendDisplay === "top" ? "column" : "row"),
    [legendDisplay],
  );

  const getPanelContextMenuItems = useCallback(() => {
    const items: PanelContextMenuItem[] = [
      {
        type: "item",
        label: t("downloadPlotDataAsCSV"),
        onclick: async () => {
          // Because the full dataset is never in the rendering thread, we have to request it from the worker.
          const data = await getFullData();
          if (data == undefined) {
            return;
          }
          const csvDatasets = [];
          for (const dataset of data.datasets.values()) {
            csvDatasets.push(dataset);
          }
          downloadCSV(csvDatasets, xAxisVal);
        },
      },
    ];
    return items;
  }, [getFullData, xAxisVal, t]);

  const onClickPath = useCallback((index: number) => {
    setFocusedPath(["paths", String(index)]);
  }, []);

  return (
    <Stack
      flex="auto"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      position="relative"
    >
      <PanelToolbar />
      <Stack
        direction={stackDirection}
        flex="auto"
        fullWidth
        style={{ height: `calc(100% - ${PANEL_TOOLBAR_MIN_HEIGHT}px)` }}
        position="relative"
      >
        {/* Pass stable values here for properties when not showing values so that the legend memoization remains stable. */}
        {legendDisplay !== "none" && (
          <PlotLegend
            currentTime={showPlotValuesInLegend ? currentTimeSinceStart : undefined}
            datasets={showPlotValuesInLegend ? datasets : EmptyDatasets}
            legendDisplay={legendDisplay}
            onClickPath={onClickPath}
            paths={yAxisPaths}
            originalPaths={originalPaths}
            pathsWithMismatchedDataLengths={memoizedPathsWithMismatchedDataLengths}
            saveConfig={saveConfig}
            showLegend={showLegend}
            showPlotValuesInLegend={showPlotValuesInLegend}
            sidebarDimension={sidebarDimension}
          />
        )}
        <Stack flex="auto" alignItems="center" justifyContent="center" overflow="hidden">
          <PlotChart
            currentTime={currentTimeSinceStart}
            eventsTimes={showMoments ? eventsTimeSinceStart : undefined}
            datasetBounds={datasetBounds}
            provider={provider}
            defaultView={defaultView}
            isSynced={xAxisVal === "timestamp" && isSynced}
            onClick={onClick}
            paths={yAxisPaths}
            showXAxisLabels={showXAxisLabels}
            xAxisName={xAxisName}
            yAxesInfo={yAxesInfo}
            xAxisVal={xAxisVal}
          />
          <PanelContextMenu getItems={getPanelContextMenuItems} />
          {showMoments && (
            <Stack
              paddingTop={1}
              fullWidth
              style={{ backgroundColor: theme.palette.background.paper }}
            >
              <MomentsList events={filteredEvents} />
            </Stack>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}

const defaultConfig: PlotConfig = {
  paths: [],
  minYValue: undefined,
  maxYValue: undefined,
  showXAxisLabels: true,
  showLegend: true,
  legendDisplay: "floating",
  showPlotValuesInLegend: false,
  isSynced: true,
  xAxisVal: "timestamp",
  sidebarDimension: defaultSidebarDimension,
  showMoments: true,
  selectRecords: [],
  showYAxisLabels: true,
  showY1Axis: false,
  showY1AxisLabels: true,
  showY2Axis: false,
  showY2AxisLabels: true,
  yMultiplicationFactor: 1,
  y1MultiplicationFactor: 1,
  y2MultiplicationFactor: 1,
};

export default Panel(
  Object.assign(Plot, {
    panelType: "Plot",
    defaultConfig,
  }),
);
