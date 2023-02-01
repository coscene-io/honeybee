// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { PanelInfo } from "@foxglove/studio-base/context/PanelCatalogContext";
import { TAB_PANEL_TYPE } from "@foxglove/studio-base/util/globalConstants";

import DataSourceInfoHelp from "./DataSourceInfo/index.help.md";
import dataSourceInfoThumbnail from "./DataSourceInfo/thumbnail.png";
import GaugeHelp from "./Gauge/index.help.md";
import gaugeThumbnail from "./Gauge/thumbnail.png";
import ImageViewHelp from "./Image/index.help.md";
import imageViewThumbnail from "./Image/thumbnail.png";
import IndicatorHelp from "./Indicator/index.help.md";
import indicatorThumbnail from "./Indicator/thumbnail.png";
import LogHelp from "./Log/index.help.md";
import logThumbnail from "./Log/thumbnail.png";
import MapHelp from "./Map/index.help.md";
import mapThumbnail from "./Map/thumbnail.png";
import NodePlaygroundHelp from "./NodePlayground/index.help.md";
import nodePlaygroundThumbnail from "./NodePlayground/thumbnail.png";
import ParametersHelp from "./Parameters/index.help.md";
import parametersThumbnail from "./Parameters/thumbnail.png";
import PlaybackPerformanceHelp from "./PlaybackPerformance/index.help.md";
import PlotHelp from "./Plot/index.help.md";
import plotThumbnail from "./Plot/thumbnail.png";
import PublishHelp from "./Publish/index.help.md";
import publishThumbnail from "./Publish/thumbnail.png";
import RawMessagesHelp from "./RawMessages/index.help.md";
import rawMessagesThumbnail from "./RawMessages/thumbnail.png";
import StateTransitionsHelp from "./StateTransitions/index.help.md";
import stateTransitionsThumbnail from "./StateTransitions/thumbnail.png";
import TabHelp from "./Tab/index.help.md";
import tabThumbnail from "./Tab/thumbnail.png";
import TableHelp from "./Table/index.help.md";
import tableThumbnail from "./Table/thumbnail.png";
import TeleopHelp from "./Teleop/index.help.md";
import teleopThumbnail from "./Teleop/thumbnail.png";
import ThreeDeeRenderHelp from "./ThreeDeeRender/index.help.md";
import threeDeeRenderThumbnail from "./ThreeDeeRender/thumbnail.png";
import TopicGraphHelp from "./TopicGraph/index.help.md";
import topicGraphThumbnail from "./TopicGraph/thumbnail.png";
import URDFViewerHelp from "./URDFViewer/index.help.md";
import URDFViewerThumbnail from "./URDFViewer/thumbnail.png";
import VariableSliderHelp from "./VariableSlider/index.help.md";
import variableSliderThumbnail from "./VariableSlider/thumbnail.png";
import DiagnosticStatusPanelHelp from "./diagnostics/DiagnosticStatusPanel.help.md";
import DiagnosticSummaryHelp from "./diagnostics/DiagnosticSummary.help.md";
import diagnosticStatusThumbnail from "./diagnostics/thumbnails/diagnostic-status.png";
import diagnosticSummaryThumbnail from "./diagnostics/thumbnails/diagnostic-summary.png";

const builtin: PanelInfo[] = [
  {
    title: "3D",
    type: "3D",
    description: "Display markers, camera images, meshes, URDFs, and more in a 3D scene.",
    help: ThreeDeeRenderHelp,
    thumbnail: threeDeeRenderThumbnail,
    module: async () => await import("./ThreeDeeRender"),
    settingsOnboardingTooltip: "Open settings to configure topics and layers.",
  },
  {
    title: `diagnosticsDetail`,
    type: "DiagnosticStatusPanel",
    description: "Display ROS DiagnosticArray messages for a specific hardware_id.",
    help: DiagnosticStatusPanelHelp,
    thumbnail: diagnosticStatusThumbnail,
    module: async () => await import("./diagnostics/DiagnosticStatusPanel"),
  },
  {
    title: `diagnosticsSummary`,
    type: "DiagnosticSummary",
    description: "Display a summary of all ROS DiagnosticArray messages.",
    help: DiagnosticSummaryHelp,
    thumbnail: diagnosticSummaryThumbnail,
    module: async () => await import("./diagnostics/DiagnosticSummary"),
  },
  {
    title: "image",
    type: "ImageViewPanel",
    description: "Display annotated images.",
    help: ImageViewHelp,
    thumbnail: imageViewThumbnail,
    module: async () => await import("./Image"),
  },
  {
    title: "indicator",
    type: "Indicator",
    description: "Display a colored and/or textual indicator based on a threshold value.",
    help: IndicatorHelp,
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
  },
  {
    title: "guage",
    type: "Gauge",
    description: "Display a colored gauge based on a continuous value.",
    help: GaugeHelp,
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
  },
  {
    title: "teleop",
    type: "Teleop",
    description: "Teleoperate a robot over a live connection.",
    help: TeleopHelp,
    thumbnail: teleopThumbnail,
    module: async () => await import("./Teleop"),
  },
  {
    title: "map",
    type: "map",
    description: "Display points on a map.",
    help: MapHelp,
    thumbnail: mapThumbnail,
    module: async () => await import("./Map"),
  },
  {
    title: "parameters",
    type: "Parameters",
    description: "Read and set parameters for a data source.",
    help: ParametersHelp,
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
  },
  {
    title: "plot",
    type: "Plot",
    description: "Plot numerical values over time or other values.",
    help: PlotHelp,
    thumbnail: plotThumbnail,
    module: async () => await import("./Plot"),
  },
  {
    title: "publish",
    type: "Publish",
    description: "Publish messages to the data source (live connections only).",
    help: PublishHelp,
    thumbnail: publishThumbnail,
    module: async () => await import("./Publish"),
  },
  {
    title: "rawMessage",
    type: "RawMessages",
    description: "Inspect topic messages.",
    help: RawMessagesHelp,
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessages"),
  },
  {
    title: "log",
    type: "RosOut",
    description: "Display logs by node and severity level.",
    help: LogHelp,
    thumbnail: logThumbnail,
    module: async () => await import("./Log"),
  },
  {
    title: "stateTransition",
    type: "StateTransitions",
    description: "Track when values change over time.",
    help: StateTransitionsHelp,
    thumbnail: stateTransitionsThumbnail,
    module: async () => await import("./StateTransitions"),
  },
  {
    title: "table",
    type: "Table",
    description: "Display topic messages in a tabular format.",
    help: TableHelp,
    thumbnail: tableThumbnail,
    module: async () => await import("./Table"),
  },
  {
    title: "urdfViewer",
    type: "URDFViewer",
    description: "Visualize Unified Robot Description Format files.",
    help: URDFViewerHelp,
    thumbnail: URDFViewerThumbnail,
    module: async () => await import("./URDFViewer"),
  },
  {
    title: "topicGraph",
    type: "TopicGraph",
    description: "Display a graph of active nodes, topics, and services.",
    help: TopicGraphHelp,
    thumbnail: topicGraphThumbnail,
    module: async () => await import("./TopicGraph"),
  },
  {
    title: "dataSourceInfo",
    type: "SourceInfo",
    description: "View details like topics and timestamps for the current data source.",
    help: DataSourceInfoHelp,
    thumbnail: dataSourceInfoThumbnail,
    module: async () => await import("./DataSourceInfo"),
  },
  {
    title: "variableSilder",
    type: "GlobalVariableSliderPanel",
    description: "Update numerical variable values for a layout.",
    help: VariableSliderHelp,
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
  },
  {
    title: "userScript",
    type: "NodePlayground",
    description:
      "Write custom data transformations in TypeScript. Previously known as Node Playground.",
    help: NodePlaygroundHelp,
    thumbnail: nodePlaygroundThumbnail,
    module: async () => await import("./NodePlayground"),
  },
  {
    title: "tab",
    type: TAB_PANEL_TYPE,
    description: "Group related panels into tabs.",
    help: TabHelp,
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
  },
];

const debug: PanelInfo[] = [
  {
    title: "studioPlaybackPerformance",
    type: "PlaybackPerformance",
    description: "Display playback and data-streaming performance statistics.",
    help: PlaybackPerformanceHelp,
    module: async () => await import("./PlaybackPerformance"),
  },
];

const legacyPlot: PanelInfo[] = [
  {
    title: "legacyPlot",
    type: "LegacyPlot",
    module: async () => await import("./LegacyPlot"),
  },
];

export default { builtin, debug, legacyPlot };
