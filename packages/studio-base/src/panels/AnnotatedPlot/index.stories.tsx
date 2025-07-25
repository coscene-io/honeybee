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

import { StoryObj } from "@storybook/react";
import { screen, userEvent, waitFor } from "@storybook/testing-library";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import { fromSec } from "@foxglove/rostime";
import Plot, { PlotConfig } from "@foxglove/studio-base/panels/Plot";
import { BlockCache, MessageEvent } from "@foxglove/studio-base/players/types";
import PanelSetup, { Fixture, triggerWheel } from "@foxglove/studio-base/stories/PanelSetup";
import { useReadySignal, ReadySignal } from "@foxglove/studio-base/stories/ReadySignalContext";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

const locationMessages = [
  {
    header: { stamp: { sec: 0, nsec: 574635076 } },
    pose: { acceleration: -0.00116662939, velocity: 1.184182664 },
  },
  {
    header: { stamp: { sec: 0, nsec: 673758203 } },
    pose: { acceleration: -0.0072101709, velocity: 1.182555127 },
  },
  {
    header: { stamp: { sec: 0, nsec: 770527187 } },
    pose: { acceleration: 0.0079536558, velocity: 1.185625054 },
  },
  {
    header: { stamp: { sec: 0, nsec: 871076484 } },
    pose: { acceleration: 0.037758707, velocity: 1.193871954 },
  },
  {
    header: { stamp: { sec: 0, nsec: 995802312 } },
    pose: { acceleration: 0.085267948, velocity: 1.210280466 },
  },
  {
    header: { stamp: { sec: 1, nsec: 81700551 } },
    pose: { acceleration: 0.34490595, velocity: 1.28371423 },
  },
  {
    header: { stamp: { sec: 1, nsec: 184463111 } },
    pose: { acceleration: 0.59131456, velocity: 1.379807198 },
  },
  {
    header: { stamp: { sec: 1, nsec: 285808851 } },
    pose: { acceleration: 0.78738064, velocity: 1.487955727 },
  },
  {
    header: { stamp: { sec: 1, nsec: 371183619 } },
    pose: { acceleration: 0.91150866, velocity: 1.581979428 },
  },
  {
    header: { stamp: { sec: 1, nsec: 479369260 } },
    pose: { acceleration: 1.03091162, velocity: 1.70297429 },
  },
  {
    header: { stamp: { sec: 1, nsec: 587095370 } },
    pose: { acceleration: 1.15341371, velocity: 1.857311045 },
  },
  {
    header: { stamp: { sec: 1, nsec: 685730694 } },
    pose: { acceleration: 1.06827219, velocity: 1.951372604 },
  },
  {
    header: { stamp: { sec: 1, nsec: 785737230 } },
    pose: { acceleration: 0.76826461, velocity: 1.98319952 },
  },
  {
    header: { stamp: { sec: 1, nsec: 869057829 } },
    pose: { acceleration: 0.52827271, velocity: 1.984654942 },
  },
  {
    header: { stamp: { sec: 1, nsec: 984145879 } },
    pose: { acceleration: 0.16827019, velocity: 1.958059206 },
  },
  {
    header: { stamp: { sec: 2, nsec: 85765716 } },
    pose: { acceleration: -0.13173667, velocity: 1.899877099 },
  },
  {
    header: { stamp: { sec: 2, nsec: 182717960 } },
    pose: { acceleration: -0.196482967, velocity: 1.87051731 },
  },
  {
    header: { stamp: { sec: 2, nsec: 286998440 } },
    pose: { acceleration: -0.204713665, velocity: 1.848811251 },
  },
  {
    header: { stamp: { sec: 2, nsec: 370689856 } },
    pose: { acceleration: -0.18596813, velocity: 1.837120153 },
  },
  {
    header: { stamp: { sec: 2, nsec: 483672422 } },
    pose: { acceleration: -0.13091373, velocity: 1.828568433 },
  },
  {
    header: { stamp: { sec: 2, nsec: 578787057 } },
    pose: { acceleration: -0.119039923, velocity: 1.82106361 },
  },
  {
    header: { stamp: { sec: 2, nsec: 677515597 } },
    pose: { acceleration: -0.419040352, velocity: 1.734159507 },
  },
  {
    header: { stamp: { sec: 2, nsec: 789110904 } },
    pose: { acceleration: -0.48790808, velocity: 1.666657974 },
  },
];

const otherStateMessages = [
  { header: { stamp: { sec: 0, nsec: 574635076 } }, items: [{ id: 42, speed: 0.1 }] },
  { header: { stamp: { sec: 0, nsec: 871076484 } }, items: [{ id: 42, speed: 0.2 }] },
  { header: { stamp: { sec: 1, nsec: 81700551 } }, items: [{ id: 42, speed: 0.3 }] },
  {
    header: { stamp: { sec: 1, nsec: 479369260 } },
    items: [
      { id: 10, speed: 1.4 },
      { id: 42, speed: 0.2 },
    ],
  },
  {
    header: { stamp: { sec: 1, nsec: 785737230 } },
    items: [
      { id: 10, speed: 1.5 },
      { id: 42, speed: 0.1 },
    ],
  },
  {
    header: { stamp: { sec: 2, nsec: 182717960 } },
    items: [
      { id: 10, speed: 1.57 },
      { id: 42, speed: 0.08 },
    ],
  },
  {
    header: { stamp: { sec: 2, nsec: 578787057 } },
    items: [
      { id: 10, speed: 1.63 },
      { id: 42, speed: 0.06 },
    ],
  },
] as const;

const withEndTime = (testFixture: Fixture, endTime: any) => ({
  ...testFixture,
  activeData: { ...testFixture.activeData, endTime },
});

const datatypes: RosDatatypes = new Map(
  Object.entries({
    "msgs/PoseDebug": {
      definitions: [
        { name: "header", type: "std_msgs/Header", isArray: false, isComplex: true },
        { name: "pose", type: "msgs/Pose", isArray: false, isComplex: true },
      ],
    },
    "msgs/Pose": {
      definitions: [
        { name: "header", type: "std_msgs/Header", isArray: false, isComplex: true },
        { name: "x", type: "float64", isArray: false },
        { name: "y", type: "float64", isArray: false },
        { name: "travel", type: "float64", isArray: false },
        { name: "velocity", type: "float64", isArray: false },
        { name: "acceleration", type: "float64", isArray: false },
        { name: "heading", type: "float64", isArray: false },
      ],
    },
    "msgs/State": {
      definitions: [
        { name: "header", type: "std_msgs/Header", isArray: false, isComplex: true },
        { name: "items", type: "msgs/OtherState", isArray: true, isComplex: true },
      ],
    },
    "msgs/OtherState": {
      definitions: [
        { name: "id", type: "int32", isArray: false },
        { name: "speed", type: "float32", isArray: false },
      ],
    },
    "std_msgs/Header": {
      definitions: [
        { name: "seq", type: "uint32", isArray: false },
        {
          name: "stamp",
          type: "time",
          isArray: false,
        },
        { name: "frame_id", type: "string", isArray: false },
      ],
    },
    "std_msgs/Bool": { definitions: [{ name: "data", type: "bool", isArray: false }] },
    "nonstd_msgs/Float64Stamped": {
      definitions: [
        { name: "header", type: "std_msgs/Header", isArray: false, isComplex: true },
        { name: "data", type: "float64", isArray: false },
      ],
    },
  }),
);

const getPreloadedMessage = (seconds: number) => ({
  topic: "/preloaded_topic",
  receiveTime: fromSec(seconds),
  message: {
    data: Math.pow(seconds, 2),
    header: { stamp: fromSec(seconds - 0.5), frame_id: "", seq: 0 },
  },
});

const emptyBlock = {
  messagesByTopic: {},
  sizeInBytes: 0,
  needTopics: new Map(),
};

const messageCache: BlockCache = {
  blocks: [
    ...[0.6, 0.7, 0.8, 0.9, 1.0].map((seconds) => ({
      sizeInBytes: 0,
      messagesByTopic: { "/preloaded_topic": [getPreloadedMessage(seconds)] },
      needTopics: new Map(),
    })),
    emptyBlock, // 1.1
    emptyBlock, // 1.2
    emptyBlock, // 1.3
    emptyBlock, // 1.4
    ...[1.5, 1.6, 1.7, 1.8, 1.9].map((seconds) => ({
      sizeInBytes: 0,
      messagesByTopic: { "/preloaded_topic": [getPreloadedMessage(seconds)] },
      needTopics: new Map(),
    })),
  ],
  startTime: fromSec(0.6),
};

export const fixture: Fixture = {
  datatypes,
  topics: [
    { name: "/some_topic/location", schemaName: "msgs/PoseDebug" },
    { name: "/some_topic/location_subset", schemaName: "msgs/PoseDebug" },
    { name: "/some_topic/location_shuffled", schemaName: "msgs/PoseDebug" },
    { name: "/some_topic/state", schemaName: "msgs/State" },
    { name: "/boolean_topic", schemaName: "std_msgs/Bool" },
    { name: "/preloaded_topic", schemaName: "nonstd_msgs/Float64Stamped" },
  ],
  activeData: {
    startTime: { sec: 0, nsec: 202050 },
    endTime: { sec: 24, nsec: 999997069 },
    currentTime: { sec: 0, nsec: 750000000 },
    isPlaying: false,
    speed: 0.2,
  },
  frame: {
    "/some_topic/location": locationMessages.map(
      (message): MessageEvent => ({
        topic: "/some_topic/location",
        receiveTime: message.header.stamp,
        message,
        schemaName: "msgs/PoseDebug",
        sizeInBytes: 0,
      }),
    ),
    "/some_topic/location_subset": locationMessages
      .slice(locationMessages.length / 3, (locationMessages.length * 2) / 3)
      .map(
        (message): MessageEvent => ({
          topic: "/some_topic/location_subset",
          receiveTime: message.header.stamp,
          message,
          schemaName: "msgs/PoseDebug",
          sizeInBytes: 0,
        }),
      ),
    "/some_topic/state": otherStateMessages.map(
      (message): MessageEvent => ({
        topic: "/some_topic/state",
        receiveTime: message.header.stamp,
        message,
        schemaName: "msgs/State",
        sizeInBytes: 0,
      }),
    ),
    "/boolean_topic": [
      {
        topic: "/boolean_topic",
        receiveTime: { sec: 1, nsec: 0 },
        message: { data: true },
        schemaName: "std_msgs/Bool",
        sizeInBytes: 0,
      },
    ],
    // Shuffle the location messages so that they are out of stamp order
    // This is used in the headerStamp series test to check that the dataset is sorted
    // prior to rendering. If the dataset is not sorted properly, the plot is jumbled.
    "/some_topic/location_shuffled": _.shuffle(
      locationMessages.map(
        (message): MessageEvent => ({
          topic: "/some_topic/location_shuffled",
          receiveTime: message.header.stamp,
          message,
          schemaName: "msgs/PoseDebug",
          sizeInBytes: 0,
        }),
      ),
    ),
  },
  progress: { messageCache },
};

export const paths: PlotConfig["paths"] = [
  { value: "/some_topic/location.pose.velocity", enabled: true, timestampMethod: "receiveTime" },
  {
    value: "/some_topic/location.pose.acceleration",
    enabled: true,
    timestampMethod: "receiveTime",
  },
  {
    value: "/some_topic/location.pose.acceleration.@derivative",
    enabled: true,
    timestampMethod: "receiveTime",
  },
  { value: "/boolean_topic.data", enabled: true, timestampMethod: "receiveTime" },
  { value: "/some_topic/state.items[0].speed", enabled: true, timestampMethod: "receiveTime" },
  { value: "/some_topic/location.header.stamp", enabled: true, timestampMethod: "receiveTime" },
];

const exampleConfig: PlotConfig = {
  paths,
  xAxisVal: "timestamp",
  showLegend: true,
  isSynced: true,
  legendDisplay: "floating",
  showXAxisLabels: true,
  showYAxisLabels: true,
  showPlotValuesInLegend: false,
  sidebarDimension: 0,
};

function useDelayedFixture(customFixture?: Fixture) {
  // HACK: when the fixture was provided immediately on first render, we encountered an ordering
  // issue where useProvider/useDatasets would process block messages before the chart was
  // registered, thus `evictCache()` would clear out all the data (since no topics were registered
  // yet).
  const finalFixture = customFixture ?? fixture;
  const { value: delayedFixture } = useAsync(async () => {
    // another tick is needed to allow the useDatasets worker to process metadata & registrations
    // before messages are delivered
    await new Promise((resolve) => setTimeout(resolve, 0));
    return finalFixture;
  }, [finalFixture]);

  // Topics and datatypes need to be present before messages are received for plots to render
  return delayedFixture ?? { topics: finalFixture.topics, datatypes: finalFixture.datatypes };
}

function PlotWrapper(props: {
  style?: { [key: string]: string | number };
  includeSettings?: boolean;
  fixture?: Fixture;
  pauseFrame: (_arg: string) => () => void;
  config: PlotConfig;
}): React.JSX.Element {
  const delayedFixture = useDelayedFixture(props.fixture);
  return (
    <PanelSetup
      fixture={delayedFixture}
      pauseFrame={props.pauseFrame}
      includeSettings={props.includeSettings}
      style={{ ...props.style }}
    >
      <Plot overrideConfig={props.config} />
    </PanelSetup>
  );
}

function useDebouncedReadySignal(): ReadySignal {
  const readySignal = useReadySignal();
  return React.useMemo(() => {
    return _.debounce(() => {
      readySignal();
    }, 3000);
  }, [readySignal]);
}

export default {
  title: "panels/Plot",
  component: Plot,
  parameters: {
    colorScheme: "light",
    chromatic: { delay: 50 },
  },
  excludeStories: ["paths", "fixture"],
};

export const Empty: StoryObj = {
  render: function Story() {
    return <PlotWrapper includeSettings pauseFrame={() => () => {}} config={Plot.defaultConfig} />;
  },
  parameters: { colorScheme: "light" },
};

export const LineGraph: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return <PlotWrapper pauseFrame={pauseFrame} config={exampleConfig} />;
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  name: "line graph",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },
};

export const LineGraphWithValuesAndDisabledSeries: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    const config = produce(exampleConfig, (draft) => {
      draft.paths[1]!.enabled = false;
      draft.showPlotValuesInLegend = true;
    });

    return <PlotWrapper pauseFrame={pauseFrame} config={config} />;
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  name: "line graph with values and disabled series",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },
};

export const LineGraphWithXMinMax: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{ ...exampleConfig, minXValue: 1, maxXValue: 2 }}
      />
    );
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  name: "line graph with x min & max",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },
};

export const LineGraphWithXRange: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{ ...exampleConfig, followingViewWidth: 3 }}
        includeSettings
      />
    );
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  name: "line graph with x range",
};

export const LineGraphWithNoTitle: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return <PlotWrapper pauseFrame={pauseFrame} config={{ ...exampleConfig, title: undefined }} />;
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  name: "line graph with no title",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },
};

export const LineGraphWithSettings: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          minYValue: -3.1415,
          maxYValue: 0.00001,
          minXValue: 0.001234,
          maxXValue: 30,
        }}
        includeSettings
      />
    );
  },

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  name: "line graph with settings",

  play: async (ctx) => {
    const yLabel = await screen.findByTestId("settings__nodeHeaderToggle__yAxis");
    await userEvent.click(yLabel);

    const xLabel = await screen.findByTestId("settings__nodeHeaderToggle__xAxis");
    await userEvent.click(xLabel);

    await ctx.parameters.storyReady;
  },
};

export const LineGraphWithSettingsChinese: StoryObj = {
  ...LineGraphWithSettings,
  parameters: {
    colorScheme: "light",
    ...LineGraphWithSettings.parameters,
    forceLanguage: "zh",
  },
};
export const LineGraphWithSettingsJapanese: StoryObj = {
  ...LineGraphWithSettings,
  parameters: {
    colorScheme: "light",
    ...LineGraphWithSettings.parameters,
    forceLanguage: "ja",
  },
};

export const LineGraphWithLegendsHidden: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    return <PlotWrapper pauseFrame={pauseFrame} config={{ ...exampleConfig, showLegend: false }} />;
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },

  name: "line graph with legends hidden",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },
};

const useStyles = makeStyles()(() => ({
  PanelSetup: {
    flexDirection: "column",
    "& > *": {
      // minHeight necessary to get around otherwise flaky test because of layout
      minHeight: "50%",
    },
  },
}));

export const InALineGraphWithMultiplePlotsXAxesAreSynced: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);
    const { classes } = useStyles();

    const delayedFixture = useDelayedFixture();
    return (
      <PanelSetup fixture={delayedFixture} pauseFrame={pauseFrame} className={classes.PanelSetup}>
        <Plot
          overrideConfig={{
            ...exampleConfig,
            paths: [
              {
                value: "/some_topic/location.pose.acceleration",
                enabled: true,
                timestampMethod: "receiveTime",
              },
            ],
          }}
        />
        <Plot
          overrideConfig={{
            ...exampleConfig,
            paths: [
              {
                value: "/some_topic/location_subset.pose.velocity",
                enabled: true,
                timestampMethod: "receiveTime",
              },
            ],
          }}
        />
      </PanelSetup>
    );
  },

  name: "in a line graph with multiple plots, x-axes are synced",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const LineGraphAfterZoom: StoryObj = {
  render: function Story() {
    const pauseState = useRef<"init" | "zoom" | "ready">("init");
    const readyState = useReadySignal();

    const doZoom = useCallback(() => {
      const canvasEl = document.querySelector("canvas");
      // Zoom is a continuous event, so we need to simulate wheel multiple times
      if (canvasEl) {
        for (let i = 0; i < 5; i++) {
          triggerWheel(canvasEl.parentElement!, 1);
        }
      }

      // indicate our next render completion should mark the scene ready
      pauseState.current = "ready";
    }, []);

    const pauseFrame = useCallback(() => {
      return () => {
        switch (pauseState.current) {
          case "init":
            pauseState.current = "zoom";
            break;
          case "zoom":
            doZoom();
            break;
          default:
            readyState();
            break;
        }
      };
    }, [doZoom, readyState]);

    return <PlotWrapper pauseFrame={pauseFrame} config={exampleConfig} />;
  },

  name: "line graph after zoom",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const TimestampMethodHeaderStamp: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location_shuffled.pose.velocity",
              enabled: true,
              timestampMethod: "headerStamp",
            },
            { value: "/boolean_topic.data", enabled: true, timestampMethod: "headerStamp" },
          ],
        }}
      />
    );
  },

  name: "timestampMethod: headerStamp",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const LongPath: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        style={{ maxWidth: 250 }}
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "long path",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const DisabledPath: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: false,
              timestampMethod: "receiveTime",
            },
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "disabled path",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const HiddenConnectingLines: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              showLine: false,
              timestampMethod: "receiveTime",
            },
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              showLine: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "hidden connecting lines",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const ReferenceLine: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            { value: "0", enabled: true, timestampMethod: "receiveTime" }, // Test typing a period for decimal values. value: "1.", enabled: true, timestampMethod: "receiveTime",
            { value: "1.", enabled: true, timestampMethod: "receiveTime" },
            { value: "1.5", enabled: true, timestampMethod: "receiveTime" },
            { value: "1", enabled: false, timestampMethod: "receiveTime" },
          ],
          minYValue: "-1",
          maxYValue: "2",
        }}
      />
    );
  },

  name: "reference line",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithMinAndMaxYValues: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        includeSettings
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          minYValue: "1",
          maxYValue: "2.8",
        }}
      />
    );
  },

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  name: "with min and max Y values",

  play: async (ctx) => {
    await ctx.parameters.storyReady;
    const label = await screen.findByText("Y Axis");
    await userEvent.click(label);
  },
};

export const WithJustMinYValueLessThanMinimumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          minYValue: "1",
        }}
      />
    );
  },

  name: "with just min Y value less than minimum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithJustMinYValueMoreThanMinimumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          minYValue: "1.4",
        }}
      />
    );
  },

  name: "with just min Y value more than minimum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithJustMinYValueMoreThanMaximumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          minYValue: "5",
        }}
      />
    );
  },

  name: "with just min Y value more than maximum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithJustMaxYValueLessThanMaximumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          maxYValue: "1.8",
        }}
      />
    );
  },

  name: "with just max Y value less than maximum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithJustMaxYValueMoreThanMaximumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          maxYValue: "2.8",
        }}
      />
    );
  },

  name: "with just max Y value more than maximum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const WithJustMaxYValueLessThanMinimumValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          maxYValue: "1",
        }}
      />
    );
  },

  name: "with just max Y value less than minimum value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const ScatterPlotPlusLineGraphPlusReferenceLine: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/state.items[:].speed",
              enabled: true,
              timestampMethod: "receiveTime",
            },
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
            { value: "3", enabled: true, timestampMethod: "receiveTime" },
          ],
        }}
      />
    );
  },

  name: "scatter plot plus line graph plus reference line",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const IndexBasedXAxisForArray: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "index",
          paths: [
            {
              value: "/some_topic/state.items[:].speed",
              enabled: true,
              timestampMethod: "receiveTime",
            }, // Should show up only in the legend: For now index plots always use playback data, and ignore preloaded data.
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
          ],
        }}
      />
    );
  },

  name: "index-based x-axis for array",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const IndexBasedXAxisForArrayWithUpdate: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    const [ourFixture, setOurFixture] = useState(structuredClone(fixture));

    useEffect(() => {
      setOurFixture((oldValue) => {
        return {
          ...oldValue,
          frame: {
            "/some_topic/state": [
              {
                topic: "/some_topic/state",
                receiveTime: { sec: 3, nsec: 0 },
                message: {
                  header: { stamp: { sec: 3, nsec: 0 } },
                  items: [
                    { id: 10, speed: 1 },
                    { id: 42, speed: 10 },
                  ],
                },
                schemaName: "msgs/State",
                sizeInBytes: 0,
              },
            ],
          },
        };
      });
    }, []);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={ourFixture}
        config={{
          ...exampleConfig,
          xAxisVal: "index",
          paths: [
            {
              value: "/some_topic/state.items[:].speed",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "index-based x-axis for array with update",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await waitFor(() => ctx.parameters.storyReady, { timeout: 10000 });
  },
};

export const CustomXAxisTopic: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "custom",
          paths: [
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          xAxisPath: { value: "/some_topic/location.pose.velocity", enabled: true },
        }}
      />
    );
  },

  name: "custom x-axis topic",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const CustomXAxisTopicWithXLimits: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "custom",
          minXValue: 1.3,
          maxXValue: 1.8,
          paths: [
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          xAxisPath: { value: "/some_topic/location.pose.velocity", enabled: true },
        }}
      />
    );
  },

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  name: "custom x-axis topic with x limits",

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const CurrentCustomXAxisTopic: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    // As above, but just shows a single point instead of the whole line.
    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "currentCustom",
          paths: [
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          xAxisPath: { value: "/some_topic/location.pose.velocity", enabled: true },
        }}
      />
    );
  },

  name: "current custom x-axis topic",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const CustomXAxisTopicWithMismatchedDataLengths: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "custom",
          paths: [
            // Extra items in y-axis
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            }, // Same number of items
            {
              value: "/some_topic/location_subset.pose.acceleration",
              enabled: true,
              timestampMethod: "receiveTime",
            }, // Fewer items in y-axis
            {
              value: "/some_topic/state.items[:].speed",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          xAxisPath: { value: "/some_topic/location_subset.pose.velocity", enabled: true },
        }}
      />
    );
  },

  name: "custom x-axis topic with mismatched data lengths",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const SuperCloseValues: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={{
          datatypes: new Map(
            Object.entries({
              "std_msgs/Float32": {
                definitions: [{ name: "data", type: "float32", isArray: false }],
              },
            }),
          ),
          topics: [{ name: "/some_number", schemaName: "std_msgs/Float32" }],
          activeData: {
            startTime: { sec: 0, nsec: 0 },
            endTime: { sec: 10, nsec: 0 },
            isPlaying: false,
            speed: 0.2,
          },
          frame: {
            "/some_number": [
              {
                topic: "/some_number",
                receiveTime: { sec: 0, nsec: 0 },
                message: { data: 1.8548483304974972 },
                schemaName: "std_msgs/Float32",
                sizeInBytes: 0,
              },
              {
                topic: "/some_number",
                receiveTime: { sec: 1, nsec: 0 },
                message: { data: 1.8548483304974974 },
                schemaName: "std_msgs/Float32",
                sizeInBytes: 0,
              },
            ],
          },
        }}
        config={{
          ...exampleConfig,
          paths: [{ value: "/some_number.data", enabled: true, timestampMethod: "receiveTime" }],
        }}
      />
    );
  },

  name: "super close values",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const TimeValues: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          xAxisVal: "custom",
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
          xAxisPath: { value: "/some_topic/location.header.stamp", enabled: true },
        }}
      />
    );
  },

  name: "time values",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const PreloadedDataInBinaryBlocks: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={withEndTime(fixture, { sec: 2, nsec: 0 })}
        config={{
          ...exampleConfig,
          paths: [
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "headerStamp" },
          ],
        }}
      />
    );
  },

  name: "preloaded data in binary blocks",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const MixedStreamedAndPreloadedData: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={withEndTime(fixture, { sec: 3, nsec: 0 })}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/state.items[0].speed",
              enabled: true,
              timestampMethod: "receiveTime",
            },
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
          ],
        }}
      />
    );
  },

  name: "mixed streamed and preloaded data",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const PreloadedDataAndItsDerivative: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={withEndTime(fixture, { sec: 2, nsec: 0 })}
        config={{
          ...exampleConfig,
          paths: [
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
            {
              value: "/preloaded_topic.data.@derivative",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "preloaded data and its derivative",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const PreloadedDataAndItsNegative: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={withEndTime(fixture, { sec: 2, nsec: 0 })}
        config={{
          ...exampleConfig,
          paths: [
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
            {
              value: "/preloaded_topic.data.@negative",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "preloaded data and its negative",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const PreloadedDataAndItsAbsoluteValue: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        fixture={withEndTime(fixture, { sec: 2, nsec: 0 })}
        config={{
          ...exampleConfig,
          paths: [
            { value: "/preloaded_topic.data", enabled: true, timestampMethod: "receiveTime" },
            {
              value: "/preloaded_topic.data.@abs",
              enabled: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "preloaded data and its absolute value",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};

export const DifferentLineSizes: StoryObj = {
  render: function Story() {
    const readySignal = useDebouncedReadySignal();
    const pauseFrame = useCallback(() => readySignal, [readySignal]);

    return (
      <PlotWrapper
        pauseFrame={pauseFrame}
        config={{
          ...exampleConfig,
          paths: [
            {
              value: "/some_topic/location.pose.velocity",
              enabled: true,
              timestampMethod: "receiveTime",
              lineSize: 2.5,
            },
            {
              value: "/some_topic/location.pose.acceleration",
              enabled: true,
              showLine: true,
              timestampMethod: "receiveTime",
            },
          ],
        }}
      />
    );
  },

  name: "different line sizes",

  parameters: {
    colorScheme: "light",
    useReadySignal: true,
  },

  play: async (ctx) => {
    await ctx.parameters.storyReady;
  },
};
