// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction, SettingsTreeNode, SettingsTreeNodes } from "@foxglove/studio";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@foxglove/studio-base/types/panels";
import { lineColors } from "@foxglove/studio-base/util/plotColors";

import { PlotPath, PlotConfig, plotPathDisplayName } from "./config";
import { plotableRosTypes } from "./plotableRosTypes";

export const DEFAULT_PATH: PlotPath = Object.freeze({
  timestampMethod: "receiveTime",
  value: "",
  enabled: true,
});

const makeSeriesNode = memoizeWeak(
  // eslint-disable-next-line @foxglove/no-boolean-parameters
  (path: PlotPath, index: number, canDelete: boolean, t: TFunction<"plot">): SettingsTreeNode => {
    return {
      actions: canDelete
        ? [
            {
              type: "action",
              id: "insert-series",
              label: t("insertSeries"),
              display: "hover",
              icon: "Addchart",
            },
            {
              type: "action",
              id: "delete-series",
              label: t("deleteSeries"),
              display: "hover",
              icon: "Clear",
            },
          ]
        : [],
      label: plotPathDisplayName(path, index, t),
      visible: path.enabled,
      expansionState: path.expansionState ?? "expanded",
      fields: {
        value: {
          label: t("messagePath"),
          input: "messagepath",
          value: path.value,
          validTypes: plotableRosTypes,
          supportsMathModifiers: true,
        },
        label: {
          input: "string",
          label: t("label"),
          value: path.label,
        },
        color: {
          input: "rgb",
          label: t("color"),
          value: path.color ?? lineColors[index % lineColors.length],
        },
        lineSize: {
          input: "number",
          label: t("lineSize"),
          value: path.lineSize,
          step: 0.2,
          min: 0,
          placeholder: t("auto", {
            ns: "general",
          }),
        },
        showLine: {
          label: t("showLine"),
          input: "boolean",
          value: path.showLine !== false,
        },
        timestampMethod: {
          input: "select",
          label: t("timestamp"),
          value: path.timestampMethod,
          options: [
            { label: t("receiveTime"), value: "receiveTime" },
            { label: t("headerStamp"), value: "headerStamp" },
          ],
        },
      },
    };
  },
);

const makeRootSeriesNode = memoizeWeak(
  (paths: PlotPath[], t: TFunction<"plot">): SettingsTreeNode => {
    const children = Object.fromEntries(
      paths.length === 0
        ? [["0", makeSeriesNode(DEFAULT_PATH, 0, /*canDelete=*/ false, t)]]
        : paths.map((path, index) => [
            `${index}`,
            makeSeriesNode(path, index, /*canDelete=*/ true, t),
          ]),
    );

    // check if all series are enabled or disabled
    // when paths is empty, treat the default displayed series as enabled
    const hasEnabledSeries = paths.length === 0 ? true : paths.some((path) => path.enabled);
    const hasDisabledSeries = paths.length === 0 ? false : paths.some((path) => !path.enabled);

    const shouldShowDisableAll = hasEnabledSeries && !hasDisabledSeries;

    const shouldCollapsedAll = paths.some((path) => path.expansionState !== "collapsed");

    return {
      label: t("series"),
      children,
      actions: [
        {
          type: "action",
          id: "add-series",
          label: t("addSeries"),
          display: "inline",
          icon: "Addchart",
        },
        {
          type: "action",
          id: "toggle-all-series",
          label: shouldShowDisableAll ? t("disableAllSeries") : t("enableAllSeries"),
          display: "inline",
          icon: shouldShowDisableAll ? "VisibilityOff" : "Visibility",
        },
        {
          type: "action",
          id: "collapse-all-series",
          label: shouldCollapsedAll ? t("collapseAllSeries") : t("expandAllSeries"),
          display: "inline",
          icon: shouldCollapsedAll ? "KeyboardDoubleArrowUpIcon" : "KeyboardDoubleArrowDownIcon",
        },
      ],
    };
  },
);

function buildSettingsTree(
  config: PlotConfig,
  t: TFunction<"plot">,
  fullTimestampStatus: "disabled" | "enabled" = "enabled",
): SettingsTreeNodes {
  const maxYError =
    _.isNumber(config.minYValue) &&
    _.isNumber(config.maxYValue) &&
    config.minYValue >= config.maxYValue
      ? t("maxYError")
      : undefined;

  const maxXError =
    _.isNumber(config.minXValue) &&
    _.isNumber(config.maxXValue) &&
    config.minXValue >= config.maxXValue
      ? t("maxXError")
      : undefined;

  return {
    general: {
      label: t("general"),
      fields: {
        isSynced: { label: t("syncWithOtherPlots"), input: "boolean", value: config.isSynced },
      },
    },
    legend: {
      label: t("legend"),
      fields: {
        legendDisplay: {
          label: t("position"),
          input: "select",
          value: config.legendDisplay,
          options: [
            { value: "floating", label: t("floating") },
            { value: "left", label: t("left") },
            { value: "top", label: t("top") },
            { value: "none", label: t("hidden") },
          ],
        },
        showPlotValuesInLegend: {
          label: t("showValues"),
          input: "boolean",
          value: config.showPlotValuesInLegend,
        },
      },
    },
    yAxis: {
      label: t("yAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        showYAxisLabels: {
          label: t("showLabels"),
          input: "boolean",
          value: config.showYAxisLabels,
        },
        minYValue: {
          label: t("min"),
          input: "number",
          value: config.minYValue != undefined ? Number(config.minYValue) : undefined,
          placeholder: t("auto", {
            ns: "general",
          }),
        },
        maxYValue: {
          label: t("max"),
          input: "number",
          error: maxYError,
          value: config.maxYValue != undefined ? Number(config.maxYValue) : undefined,
          placeholder: t("auto", {
            ns: "general",
          }),
        },
      },
    },
    xAxis: {
      label: t("xAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        xAxisVal: {
          label: t("value"),
          input: "select",
          value: config.xAxisVal,
          options: [
            {
              label: t("fullTimestamp"),
              value: "timestamp",
              disabled: fullTimestampStatus === "disabled",
            },
            { label: t("partialTimestamp"), value: "partialTimestamp" },
            { label: t("index"), value: "index" },
            { label: t("currentPath"), value: "currentCustom" },
            { label: t("accumulatedPath"), value: "custom" },
          ],
          help: fullTimestampStatus === "disabled" ? t("tooManyMessages") : undefined,
        },
        xAxisPath:
          config.xAxisVal === "currentCustom" || config.xAxisVal === "custom"
            ? {
                label: t("messagePath"),
                input: "messagepath",
                value: config.xAxisPath?.value ?? "",
                validTypes: plotableRosTypes,
              }
            : undefined,
        showXAxisLabels: {
          label: t("showLabels"),
          input: "boolean",
          value: config.showXAxisLabels,
        },
        minXValue: {
          label: t("min"),
          input: "number",
          value: config.minXValue != undefined ? Number(config.minXValue) : undefined,
          placeholder: t("auto", {
            ns: "general",
          }),
        },
        maxXValue: {
          label: t("max"),
          input: "number",
          error: maxXError,
          value: config.maxXValue != undefined ? Number(config.maxXValue) : undefined,
          placeholder: t("auto", {
            ns: "general",
          }),
        },
        followingViewWidth: {
          label: t("secondsRange"),
          input: "number",
          placeholder: t("auto", {
            ns: "general",
          }),
          value: config.followingViewWidth,
        },
      },
    },
    paths: makeRootSeriesNode(config.paths, t),
  };
}

export function usePlotPanelSettings(
  config: PlotConfig,
  saveConfig: SaveConfig<PlotConfig>,
  focusedPath?: readonly string[],
  fullTimestampStatus: "disabled" | "enabled" = "enabled",
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("plot");

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update") {
        const { path, value } = action.payload;
        saveConfig(
          produce((draft) => {
            if (path[0] === "paths") {
              if (draft.paths.length === 0) {
                draft.paths.push({ ...DEFAULT_PATH });
              }
              if (path[2] === "visible") {
                _.set(draft, [...path.slice(0, 2), "enabled"], value);
              } else {
                _.set(draft, path, value);
              }
            } else if (_.isEqual(path, ["legend", "legendDisplay"])) {
              draft.legendDisplay = value;
              draft.showLegend = true;
            } else if (_.isEqual(path, ["xAxis", "xAxisPath"])) {
              _.set(draft, ["xAxisPath", "value"], value);
            } else {
              _.set(draft, path.slice(1), value);

              // X min/max and following width are mutually exclusive.
              if (path[1] === "followingViewWidth") {
                draft.minXValue = undefined;
                draft.maxXValue = undefined;
              } else if (path[1] === "minXValue" || path[1] === "maxXValue") {
                draft.followingViewWidth = undefined;
              }
            }
          }),
        );
      } else {
        if (action.payload.id === "add-series") {
          saveConfig(
            produce<PlotConfig>((draft) => {
              if (draft.paths.length === 0) {
                draft.paths.unshift({ ...DEFAULT_PATH });
              }
              draft.paths.unshift({ ...DEFAULT_PATH });
            }),
          );
        } else if (action.payload.id === "insert-series") {
          const index = action.payload.path[1];
          saveConfig(
            produce<PlotConfig>((draft) => {
              draft.paths.splice(Number(index) + 1, 0, { ...DEFAULT_PATH });
            }),
          );
        } else if (action.payload.id === "delete-series") {
          const index = action.payload.path[1];
          saveConfig(
            produce<PlotConfig>((draft) => {
              draft.paths.splice(Number(index), 1);
            }),
          );
        } else if (action.payload.id === "toggle-all-series") {
          saveConfig(
            produce<PlotConfig>((draft) => {
              // if no paths exist, add the default path first
              if (draft.paths.length === 0) {
                draft.paths.unshift({ ...DEFAULT_PATH });
              }

              const hasEnabledSeries = draft.paths.some((path) => path.enabled);
              const hasDisabledSeries = draft.paths.some((path) => !path.enabled);
              const shouldDisableAll = hasEnabledSeries && !hasDisabledSeries;

              for (const path of draft.paths) {
                path.enabled = !shouldDisableAll;
              }
            }),
          );
        } else if (action.payload.id === "collapse-all-series") {
          saveConfig(
            produce<PlotConfig>((draft) => {
              const shouldCollapsedAll = draft.paths.some(
                (path) => path.expansionState !== "collapsed",
              );

              for (const path of draft.paths) {
                path.expansionState = shouldCollapsedAll ? "collapsed" : "expanded";
              }
            }),
          );
        }
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      focusedPath,
      nodes: buildSettingsTree(config, t, fullTimestampStatus),
    });
  }, [actionHandler, config, focusedPath, updatePanelSettingsTree, t]);
}
