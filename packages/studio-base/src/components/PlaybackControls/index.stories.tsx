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

import { action } from "@storybook/addon-actions";
import { StoryObj, StoryFn } from "@storybook/react";
import { useEffect, useLayoutEffect } from "react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext, {
  IAppConfiguration,
} from "@foxglove/studio-base/context/AppConfigurationContext";
import { useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useSetHoverValue } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import {
  PlayerCapabilities,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@foxglove/studio-base/players/types";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { makeMockEvents } from "@foxglove/studio-base/test/mocks/makeMockEvents";

import PlaybackControls from "./index";

const START_TIME = 1531761690;

function getPlayerState(): PlayerState {
  const player: PlayerState = {
    presence: PlayerPresence.PRESENT,
    progress: {},
    capabilities: [PlayerCapabilities.setSpeed, PlayerCapabilities.playbackControl],
    profile: undefined,
    playerId: "1",
    activeData: {
      messages: [],
      startTime: { sec: START_TIME, nsec: 331 },
      endTime: { sec: START_TIME + 20, nsec: 331 },
      currentTime: { sec: START_TIME + 5, nsec: 331 },
      isPlaying: true,
      repeatEnabled: false,
      speed: 0.2,
      lastSeekTime: 0,
      topics: [{ name: "/empty_topic", schemaName: "VoidType" }],
      topicStats: new Map(),
      datatypes: new Map(Object.entries({ VoidType: { definitions: [] } })),
      totalBytesReceived: 1234,
    },
  };
  return player;
}

const mockAppConfiguration: IAppConfiguration = {
  get: (key: string) => {
    if (key === "timezone") {
      return "America/Los_Angeles";
    } else {
      return undefined;
    }
  },
  set: async () => {},
  addChangeListener: () => {},
  removeChangeListener: () => {},
};

function Wrapper({
  isPlaying = false,
  activeData,
  children,
  progress,
  presence,
  noActiveData,
}: {
  isPlaying?: boolean;
  activeData?: PlayerStateActiveData;
  children: React.ReactNode;
  progress?: PlayerState["progress"];
  presence?: PlayerState["presence"];
  noActiveData?: boolean;
}) {
  return (
    <MockMessagePipelineProvider
      isPlaying={isPlaying}
      capabilities={["setSpeed", "playbackControl"]}
      presence={presence}
      activeData={activeData}
      pausePlayback={action("pause")}
      seekPlayback={action("seek")}
      startPlayback={action("play")}
      progress={progress}
      noActiveData={noActiveData}
    >
      <div style={{ padding: 20, margin: 20 }}>{children}</div>
    </MockMessagePipelineProvider>
  );
}

export default {
  title: "components/PlaybackControls",
  decorators: [
    (Wrapped: StoryFn): React.JSX.Element => (
      <AppConfigurationContext.Provider value={mockAppConfiguration}>
        <WorkspaceContextProvider>
          <MockCurrentLayoutProvider>
            <EventsProvider>
              <Wrapped />
            </EventsProvider>
          </MockCurrentLayoutProvider>
        </WorkspaceContextProvider>
      </AppConfigurationContext.Provider>
    ),
  ],
};

export const Playing: StoryObj = {
  render: () => {
    return (
      <Wrapper isPlaying>
        <PlaybackControls
          isPlaying={true}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};

export const Paused: StoryObj = {
  render: () => {
    return (
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};

export const Disabled: StoryObj = {
  render: () => {
    return (
      <Wrapper presence={PlayerPresence.ERROR} noActiveData>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};

export const DownloadProgressByRanges: StoryObj = {
  render: () => {
    const player = getPlayerState();
    player.progress = {
      ...player.progress,
      fullyLoadedFractionRanges: [
        { start: -2, end: 0.1 },
        { start: 0.23, end: 0.6 },
        { start: 0.7, end: 1 },
      ],
    };
    return (
      <Wrapper progress={player.progress}>
        <PlaybackControls
          isPlaying
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};

export const HoverTicks: StoryObj = {
  render: function Story() {
    const player = getPlayerState();
    const setHoverValue = useSetHoverValue();

    useLayoutEffect(() => {
      setHoverValue({
        type: "PLAYBACK_SECONDS",
        value: 0.5,
        componentId: "story",
      });
    }, [setHoverValue]);

    return (
      <Wrapper activeData={player.activeData}>
        <PlaybackControls
          isPlaying
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};

export const WithEvents: StoryObj = {
  render: function Story() {
    const player = getPlayerState();
    const setEvents = useEvents((store) => store.setEvents);

    useEffect(() => {
      setEvents({ loading: false, value: makeMockEvents(4, START_TIME + 1, 4) });
    });

    return (
      <Wrapper activeData={player.activeData}>
        <PlaybackControls
          isPlaying
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={action("play")}
          pause={action("pause")}
          seek={action("seek")}
          enableRepeatPlayback={action("enable-repeat-playback")}
        />
      </Wrapper>
    );
  },

  parameters: { colorScheme: "both-column" },
};
