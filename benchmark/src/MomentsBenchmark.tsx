// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { fromSec, type Time } from "@foxglove/rostime";
import CssBaseline from "@foxglove/studio-base/components/CssBaseline";
import { EventsList } from "@foxglove/studio-base/components/Events/EventsList";
import { EventsSyncAdapter } from "@foxglove/studio-base/components/Events/EventsSyncAdapter";
import { MomentSubtitleOverlay } from "@foxglove/studio-base/components/Events/MomentSubtitleOverlay";
import GlobalCss from "@foxglove/studio-base/components/GlobalCss";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import Scrubber from "@foxglove/studio-base/components/PlaybackControls/Scrubber";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  useEvents,
  type TimelinePositionedEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { initI18n } from "@foxglove/studio-base/i18n";
import MomentsList from "@foxglove/studio-base/panels/MomentsBar/MomentsList";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import {
  makeMomentFixture,
  type MomentDistribution,
} from "@foxglove/studio-base/test/fixtures/moments";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";
import waitForFonts from "@foxglove/studio-base/util/waitForFonts";

const origin = { sec: 0, nsec: 0 };
const end = { sec: 3600, nsec: 0 };
const configuration = makeMockAppConfiguration();
const allowed = Object.assign(async () => ({}), { permission: () => true });
const api = {
  updateEvent: allowed,
  createEvent: allowed,
  deleteEvent: allowed,
  getDiagnosisRule: async () => ({ rules: [] }),
  batchGetUsers: async () => ({ users: [] }),
} as unknown as React.ContextType<typeof CoSceneConsoleApiContext>;

function Seed({
  events,
  extras,
}: {
  events: TimelinePositionedEvent[];
  extras: boolean;
}): ReactNull {
  const setEvents = useEvents((store) => store.setEvents);
  const setDataSource = useCoreData((store) => store.setDataSource);
  const setProject = useCoreData((store) => store.setProject);
  const setRecord = useCoreData((store) => store.setRecord);
  const {
    playbackControlActions: { setMomentSubtitleEnabled },
  } = useWorkspaceActions();
  useEffect(() => {
    setEvents({ loading: false, value: events });
    setDataSource({ id: "coscene-data-platform", type: "connection" });
    setProject({ loading: false, value: { isArchived: false } as never });
    setRecord({ loading: false, value: { isArchived: false } as never });
    setMomentSubtitleEnabled(extras);
  }, [events, extras, setEvents, setDataSource, setProject, setRecord, setMomentSubtitleEnabled]);
  return ReactNull;
}

function MomentsBenchmark(): React.JSX.Element {
  const [locationSearch, setLocationSearch] = useState(window.location.search);
  useEffect(() => {
    const update = () => {
      setLocationSearch(window.location.search);
    };
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("popstate", update);
    };
  }, []);
  const query = new URLSearchParams(locationSearch);
  const count = Number(query.get("count") ?? 1000);
  const distribution = (query.get("distribution") ?? "short") as MomentDistribution;
  const extras = query.get("extras") === "true";
  const events = useMemo(
    () => makeMomentFixture(count, distribution, origin),
    [count, distribution],
  );
  const [currentTime, setCurrentTime] = useState<Time>(origin);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) {
      return;
    }
    const start = performance.now();
    let frame: number;
    const tick = () => {
      setCurrentTime(fromSec(((performance.now() - start) / 1000) % 3600));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing]);
  return (
    <ThemeProvider isDark>
      <GlobalCss />
      <CssBaseline>
        <AppConfigurationContext.Provider value={configuration}>
          <CoSceneConsoleApiContext.Provider value={api}>
            <CoreDataProvider>
              <WorkspaceContextProvider disablePersistence>
                <DialogsProvider>
                  <MockMessagePipelineProvider
                    startTime={origin}
                    endTime={end}
                    currentTime={currentTime}
                    seekPlayback={setCurrentTime}
                  >
                    <PlaybackInteractionStateProvider>
                      <TimelineInteractionStateProvider>
                        <CoScenePlaylistProvider>
                          <EventsProvider>
                            <Seed events={events} extras={extras} />
                            <EventsSyncAdapter />
                            <div
                              style={{
                                height: "100vh",
                                display: "flex",
                                flexDirection: "column",
                                background: "#121212",
                                color: "white",
                              }}
                            >
                              <button
                                onClick={() => {
                                  setPlaying((value) => !value);
                                }}
                              >
                                Toggle playback
                              </button>
                              <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p>
                                    {count} moments / {distribution}
                                  </p>
                                  {extras && <MomentsList events={events} />}
                                </div>
                                {extras && (
                                  <div style={{ width: 380 }}>
                                    <EventsList />
                                  </div>
                                )}
                              </div>
                              <div
                                style={{ height: 240, display: "flex", flexDirection: "column" }}
                              >
                                <Scrubber onSeek={setCurrentTime} />
                              </div>
                              {extras && <MomentSubtitleOverlay />}
                            </div>
                          </EventsProvider>
                        </CoScenePlaylistProvider>
                      </TimelineInteractionStateProvider>
                    </PlaybackInteractionStateProvider>
                  </MockMessagePipelineProvider>
                </DialogsProvider>
              </WorkspaceContextProvider>
            </CoreDataProvider>
          </CoSceneConsoleApiContext.Provider>
        </AppConfigurationContext.Provider>
      </CssBaseline>
    </ThemeProvider>
  );
}

void Promise.all([initI18n(), waitForFonts()]).then(() => {
  createRoot(document.getElementById("root")!).render(<MomentsBenchmark />);
});
