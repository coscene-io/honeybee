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
    description: "threeDDescription",
    help: ThreeDeeRenderHelp,
    thumbnail: threeDeeRenderThumbnail,
    module: async () => await import("./ThreeDeeRender"),
    settingsOnboardingTooltip: "Open settings to configure topics and layers.",
  },
  {
    title: `diagnosticsDetail`,
    type: "DiagnosticStatusPanel",
    description: "diagnoticsDetailDesciption",
    help: DiagnosticStatusPanelHelp,
    thumbnail: diagnosticStatusThumbnail,
    module: async () => await import("./diagnostics/DiagnosticStatusPanel"),
  },
  {
    title: `diagnosticsSummary`,
    type: "DiagnosticSummary",
    description: "diagnosticsSummaryDecription",
    help: DiagnosticSummaryHelp,
    thumbnail: diagnosticSummaryThumbnail,
    module: async () => await import("./diagnostics/DiagnosticSummary"),
  },
  {
    title: "image",
    type: "ImageViewPanel",
    description: "Display annotated images",
    help: ImageViewHelp,
    thumbnail: imageViewThumbnail,
    module: async () => await import("./Image"),
  },
  {
    title: "indicator",
    type: "Indicator",
    description: "indicatorDescription",
    help: IndicatorHelp,
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
  },
  {
    title: "guage",
    type: "Gauge",
    description: "guageDescription",
    help: GaugeHelp,
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
  },
  {
    title: "teleop",
    type: "Teleop",
    description: "teleopDescription",
    help: TeleopHelp,
    thumbnail: teleopThumbnail,
    module: async () => await import("./Teleop"),
  },
  {
    title: "map",
    type: "map",
    description: "mapDescription",
    help: MapHelp,
    thumbnail: mapThumbnail,
    module: async () => await import("./Map"),
  },
  {
    title: "parameters",
    type: "Parameters",
    description: "parametersDescription",
    help: ParametersHelp,
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
  },
  {
    title: "plot",
    type: "Plot",
    description: "plotDescription",
    help: PlotHelp,
    thumbnail: plotThumbnail,
    module: async () => await import("./Plot"),
  },
  {
    title: "publish",
    type: "Publish",
    description: "publishDescription",
    help: PublishHelp,
    thumbnail: publishThumbnail,
    module: async () => await import("./Publish"),
  },
  {
    title: "rawMessage",
    type: "RawMessages",
    description: "rawMessageDescription",
    help: RawMessagesHelp,
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessages"),
  },
  {
    title: "log",
    type: "RosOut",
    description: "logDescription",
    help: LogHelp,
    thumbnail: logThumbnail,
    module: async () => await import("./Log"),
  },
  {
    title: "stateTransition",
    type: "StateTransitions",
    description: "stateDescription",
    help: StateTransitionsHelp,
    thumbnail: stateTransitionsThumbnail,
    module: async () => await import("./StateTransitions"),
  },
  {
    title: "table",
    type: "Table",
    description: "tableDescription",
    help: TableHelp,
    thumbnail: tableThumbnail,
    module: async () => await import("./Table"),
  },
  {
    title: "urdfViewer",
    type: "URDFViewer",
    description: "urdfDescription",
    help: URDFViewerHelp,
    thumbnail: URDFViewerThumbnail,
    module: async () => await import("./URDFViewer"),
  },
  {
    title: "topicGraph",
    type: "TopicGraph",
    description: "topicGraphDescription",
    help: TopicGraphHelp,
    thumbnail: topicGraphThumbnail,
    module: async () => await import("./TopicGraph"),
  },
  {
    title: "dataSourceInfo",
    type: "SourceInfo",
    description: "dataSourceDesciption",
    help: DataSourceInfoHelp,
    thumbnail: dataSourceInfoThumbnail,
    module: async () => await import("./DataSourceInfo"),
  },
  {
    title: "variableSilder",
    type: "GlobalVariableSliderPanel",
    description: "variableDescription",
    help: VariableSliderHelp,
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
  },
  {
    title: "userScript",
    type: "NodePlayground",
    description: "userScriptDescription",
    help: NodePlaygroundHelp,
    thumbnail: nodePlaygroundThumbnail,
    module: async () => await import("./NodePlayground"),
  },
  {
    title: "tab",
    type: TAB_PANEL_TYPE,
    description: "tabDescription",
    help: TabHelp,
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
  },
];

const debug: PanelInfo[] = [
  {
    title: "studioPlaybackPerformance",
    type: "PlaybackPerformance",
    description: "studioDescription",
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
