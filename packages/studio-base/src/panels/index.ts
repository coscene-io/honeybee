// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { PanelInfo } from "@foxglove/studio-base/context/PanelCatalogContext";
import { TAB_PANEL_TYPE } from "@foxglove/studio-base/util/globalConstants";

import dataSourceInfoThumbnail from "./DataSourceInfo/thumbnail.png";
import gaugeThumbnail from "./Gauge/thumbnail.png";
import imageViewThumbnail from "./Image/thumbnail.png";
import indicatorThumbnail from "./Indicator/thumbnail.png";
import logThumbnail from "./Log/thumbnail.png";
import mapThumbnail from "./Map/thumbnail.png";
import nodePlaygroundThumbnail from "./NodePlayground/thumbnail.png";
import parametersThumbnail from "./Parameters/thumbnail.png";
import plotThumbnail from "./Plot/thumbnail.png";
import publishThumbnail from "./Publish/thumbnail.png";
import rawMessagesThumbnail from "./RawMessages/thumbnail.png";
import stateTransitionsThumbnail from "./StateTransitions/thumbnail.png";
import tabThumbnail from "./Tab/thumbnail.png";
import tableThumbnail from "./Table/thumbnail.png";
import teleopThumbnail from "./Teleop/thumbnail.png";
import threeDeeRenderThumbnail from "./ThreeDeeRender/thumbnail.png";
import topicGraphThumbnail from "./TopicGraph/thumbnail.png";
import URDFViewerThumbnail from "./URDFViewer/thumbnail.png";
import variableSliderThumbnail from "./VariableSlider/thumbnail.png";
import diagnosticStatusThumbnail from "./diagnostics/thumbnails/diagnostic-status.png";
import diagnosticSummaryThumbnail from "./diagnostics/thumbnails/diagnostic-summary.png";

export const builtin: PanelInfo[] = [
  {
    title: "3D",
    type: "3D",
    description: "Display markers, camera images, meshes, URDFs, and more in a 3D scene.",
    thumbnail: threeDeeRenderThumbnail,
    module: async () => await import("./ThreeDeeRender"),
    settingsOnboardingTooltip: "Open settings to configure topics and layers.",
  },
  {
    title: `diagnosticsDetail`,
    type: "DiagnosticStatusPanel",
    description: "diagnosticsDetailDescription",
    thumbnail: diagnosticStatusThumbnail,
    module: async () => await import("./diagnostics/DiagnosticStatusPanel"),
    hasCustomToolbar: true,
  },
  {
    title: `diagnosticsSummary`,
    type: "DiagnosticSummary",
    description: "diagnosticsSummaryDescription",
    thumbnail: diagnosticSummaryThumbnail,
    module: async () => await import("./diagnostics/DiagnosticSummary"),
    hasCustomToolbar: true,
  },
  {
    title: "image",
    type: "ImageViewPanel",
    description: "Display annotated images.",
    thumbnail: imageViewThumbnail,
    module: async () => await import("./Image"),
  },
  {
    title: "indicator",
    type: "Indicator",
    description: "indicatorDescription",
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
  },
  {
    title: "gauge",
    type: "Gauge",
    description: "gaugeDescription",
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
  },
  {
    title: "teleop",
    type: "Teleop",
    description: "teleopDescription",
    thumbnail: teleopThumbnail,
    module: async () => await import("./Teleop"),
  },
  {
    title: "map",
    type: "map",
    description: "mapDescription",
    thumbnail: mapThumbnail,
    module: async () => await import("./Map"),
  },
  {
    title: "parameters",
    type: "Parameters",
    description: "parametersDescription",
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
  },
  {
    title: "plot",
    type: "Plot",
    description: "plotDescription",
    thumbnail: plotThumbnail,
    module: async () => await import("./Plot"),
  },
  {
    title: "publish",
    type: "Publish",
    description: "publishDescription",
    thumbnail: publishThumbnail,
    module: async () => await import("./Publish"),
  },
  {
    title: "rawMessage",
    type: "RawMessages",
    description: "rawMessageDescription",
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessages"),
    hasCustomToolbar: true,
  },
  {
    title: "log",
    type: "RosOut",
    description: "logDescription",
    thumbnail: logThumbnail,
    module: async () => await import("./Log"),
    hasCustomToolbar: true,
  },
  {
    title: "stateTransition",
    type: "StateTransitions",
    description: "stateDescription",
    thumbnail: stateTransitionsThumbnail,
    module: async () => await import("./StateTransitions"),
  },
  {
    title: "table",
    type: "Table",
    description: "tableDescription",
    thumbnail: tableThumbnail,
    module: async () => await import("./Table"),
    hasCustomToolbar: true,
  },
  {
    title: "topicGraph",
    type: "TopicGraph",
    description: "topicGraphDescription",
    thumbnail: topicGraphThumbnail,
    module: async () => await import("./TopicGraph"),
  },
  {
    title: "dataSourceInfo",
    type: "SourceInfo",
    description: "dataSourceDescription",
    thumbnail: dataSourceInfoThumbnail,
    module: async () => await import("./DataSourceInfo"),
  },
  {
    title: "variableSlider",
    type: "GlobalVariableSliderPanel",
    description: "variableDescription",
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
  },
  {
    title: "userScript",
    type: "NodePlayground",
    description: "userScriptDescription",
    thumbnail: nodePlaygroundThumbnail,
    module: async () => await import("./NodePlayground"),
  },
  {
    title: "tab",
    type: TAB_PANEL_TYPE,
    description: "tabDescription",
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
    hasCustomToolbar: true,
  },
];

export const debug: PanelInfo[] = [
  {
    title: "studioPlaybackPerformance",
    type: "PlaybackPerformance",
    description: "studioDescription",
    module: async () => await import("./PlaybackPerformance"),
  },
];

export const legacyPlot: PanelInfo = {
  title: "legacyPlot",
  type: "LegacyPlot",
  module: async () => await import("./LegacyPlot"),
};

export const urdfViewer: PanelInfo = {
  title: "urdfViewer",
  type: "URDFViewer",
  description: "urdfDescription",
  thumbnail: URDFViewerThumbnail,
  module: async () => await import("./URDFViewer"),
};
