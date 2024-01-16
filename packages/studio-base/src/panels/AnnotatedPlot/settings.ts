// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction, SettingsTreeNode, SettingsTreeNodes } from "@foxglove/studio";
import * as PanelAPI from "@foxglove/studio-base/PanelAPI";
import {
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  SettingsPlotPath,
  PlotLine,
} from "@foxglove/studio-base/panels/AnnotatedPlot/internalTypes";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@foxglove/studio-base/types/panels";
import { lineColors } from "@foxglove/studio-base/util/plotColors";

import { plotableRosTypes, PlotConfig, plotPathDisplayName } from "./types";

export const DEFAULT_PATH: SettingsPlotPath = Object.freeze({
  value: "",
  label: "",
  lines: [],
});

const DEFAULT_PLOT_LINE: PlotLine = {
  value: "",
  enabled: true,
  timestampMethod: "receiveTime",
};
const makeSeriesLineNode = memoizeWeak(
  (line: PlotLine, t: TFunction<"plot">, index: number): SettingsTreeNode => {
    return {
      label: line.label,
      visible: line.enabled,
      fields: {
        label: {
          input: "string",
          label: t("label"),
          value: line.label,
        },
        color: {
          input: "rgb",
          label: t("color"),
          value: line.color ?? lineColors[index],
        },
        lineSize: {
          input: "number",
          label: t("lineSize"),
          value: line.lineSize,
          step: 0.2,
          min: 0,
          placeholder: "auto",
        },
        showLine: {
          label: t("showLine"),
          input: "boolean",
          value: line.showLine !== false,
        },
        timestampMethod: {
          input: "select",
          label: t("timestamp"),
          value: line.timestampMethod,
          options: [
            { label: t("receiveTime"), value: "receiveTime" },
            { label: t("headerStamp"), value: "headerStamp" },
          ],
        },
      },
    };
  },
);

const makeSeriesNode = memoizeWeak(
  (
    path: SettingsPlotPath,
    index: number,
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    canDelete: boolean,
    t: TFunction<"plot">,
  ): SettingsTreeNode => {
    const children = Object.fromEntries(
      path.lines.map((line, lineIndex) => [`${lineIndex}`, makeSeriesLineNode(line, t, lineIndex)]),
    );

    return {
      actions: canDelete
        ? [
            {
              type: "action",
              id: "delete-series",
              label: t("deleteSeries"),
              display: "inline",
              icon: "Clear",
            },
          ]
        : [],
      label: plotPathDisplayName(path, index),
      fields: {
        value: {
          label: t("messagePath"),
          input: "deduplicatedMessagePath",
          value: path.value,
          validTypes: plotableRosTypes,
          supportsMathModifiers: true,
        },
        label: {
          input: "string",
          label: t("label"),
          value: path.label,
        },
      },
      children,
    };
  },
);

const makeRootSeriesNode = memoizeWeak(
  (paths: SettingsPlotPath[], t: TFunction<"plot">): SettingsTreeNode => {
    const children = Object.fromEntries(
      paths.length === 0
        ? [["0", makeSeriesNode(DEFAULT_PATH, 0, /*canDelete=*/ false, t)]]
        : paths.map((path, index) => [
            `${index}`,
            makeSeriesNode(path, index, /*canDelete=*/ true, t),
          ]),
    );
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
      ],
    };
  },
);

function buildSettingsTree(
  config: PlotConfig,
  t: TFunction<"plot">,
  selectRecordsOptions: { label: string; value: string }[],
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
    moments: {
      label: t("moments", {
        ns: "cosEvent",
      }),
      fields: {
        showMoments: {
          label: t("showMoments", {
            ns: "cosEvent",
          }),
          input: "boolean",
          value: config.showMoments,
        },
        selectRecords: {
          label: t("filterByRecord", {
            ns: "cosEvent",
          }),
          input: "multipleSelect",
          value: config.selectRecords,
          options: selectRecordsOptions,
        },
        momentsFilter: {
          label: t("filterMoments", {
            ns: "cosEvent",
          }),
          input: "string",
          value: config.momentsFilter,
          placeholder: t("searchByKV", {
            ns: "cosEvent",
          }),
        },
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
          placeholder: "auto",
        },
        maxYValue: {
          label: t("max"),
          input: "number",
          error: maxYError,
          value: config.maxYValue != undefined ? Number(config.maxYValue) : undefined,
          placeholder: "auto",
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
            { label: t("timestamp"), value: "timestamp" },
            { label: t("index"), value: "index" },
            { label: t("currentPath"), value: "currentCustom" },
            { label: t("accumulatedPath"), value: "custom" },
          ],
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
          placeholder: "auto",
        },
        maxXValue: {
          label: t("max"),
          input: "number",
          error: maxXError,
          value: config.maxXValue != undefined ? Number(config.maxXValue) : undefined,
          placeholder: "auto",
        },
        followingViewWidth: {
          label: t("secondsRange"),
          input: "number",
          placeholder: "auto",
          value: config.followingViewWidth,
        },
      },
    },
    paths: makeRootSeriesNode(config.paths, t),
  };
}

/**
 * Filter targetValue for values ending with the same content as the topicNames quotes.
 * @param targetValue string array, like ["/woodiiTest/new data/Data.mcap@温度02", "/woodiiTest/new data/Data.mcap@温度07"]
 * @param topicNames string, like "温度02".value
 * @returns string array, The string matched in the target value
 */
function matchingFields(targetValue: string, topicNames: string[]): string[] {
  const topic = targetValue.replace(/"/g, "").split(".")[0];

  return topicNames.filter((item) => item.endsWith("@" + topic));
}

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;

export function usePlotPanelSettings(
  config: PlotConfig,
  saveConfig: SaveConfig<PlotConfig>,
  focusedPath?: readonly string[],
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("plot");
  const { topics } = PanelAPI.useDataSourceInfo();

  const bagFiles = usePlaylist(selectBagFiles);

  const topicNames = useMemo(() => topics.map((topic) => topic.name), [topics]);

  const records = useMemo(() => {
    return bagFiles.value
      ?.filter((file) => {
        return (
          (file.fileType === "GHOST_SOURCE_FILE" || file.fileType === "NORMAL_FILE") &&
          file.recordDisplayName != undefined &&
          file.name.split("/revisions/")[0] != undefined
        );
      })
      .map((file) => ({
        label: file.recordDisplayName ?? "",
        value: file.name.split("/revisions/")[0] ?? "",
      }));
  }, [bagFiles.value]);

  useEffect(() => {
    if (topicNames.length > 0) {
      saveConfig(
        produce((draft) => {
          config.paths.forEach((path, index) => {
            const value = path.value;
            const matchingTopicNames = matchingFields(value, topicNames);
            draft.paths[index].lines = matchingTopicNames.map((topicName) => {
              return {
                ...DEFAULT_PLOT_LINE,
                value: `"${topicName}".${value.split(".")[1]}`,
                label: `"${topicName}".${value.split(".")[1]}`,
              };
            });
          });
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicNames]);

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
                if (path.length === 4) {
                  // set child lines
                  if (path[2] != undefined && path[3] === "visible") {
                    _.set(draft, [...path.slice(0, 2), "lines", path[2], "enabled"], value);
                  } else {
                    _.set(draft, [...path.slice(0, 2), "lines", ...path.slice(2)], value);
                  }
                } else {
                  _.set(draft, path, value);
                  if (path[2] === "value") {
                    if (value != undefined && typeof value === "string" && path[1] != undefined) {
                      const matchingTopicNames = matchingFields(value, topicNames);
                      // add sub line
                      draft.paths[path[1]].lines = matchingTopicNames.map((topicName) => {
                        return {
                          ...DEFAULT_PLOT_LINE,
                          value: `"${topicName}".${value.split(".")[1]}`,
                          label: `"${topicName}".${value.split(".")[1]}`,
                        };
                      });
                    }
                  }
                }
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
                draft.paths.push({ ...DEFAULT_PATH });
              }
              draft.paths.push({ ...DEFAULT_PATH });
            }),
          );
        } else if (action.payload.id === "delete-series") {
          const index = action.payload.path[1];
          saveConfig(
            produce<PlotConfig>((draft) => {
              draft.paths.splice(Number(index), 1);
            }),
          );
        }
      }
    },
    [saveConfig, topicNames],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      focusedPath,
      nodes: buildSettingsTree(config, t, records ?? []),
    });
  }, [actionHandler, config, focusedPath, updatePanelSettingsTree, t, records]);
}
