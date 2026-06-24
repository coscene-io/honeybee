/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";

import type { Time } from "@foxglove/rostime";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import PlaybackControls from ".";

jest.mock("./PlaybackTimeDisplay", () => ({
  __esModule: true,
  default: function MockPlaybackTimeDisplay({ onSeek }: { onSeek: (seekTo: Time) => void }) {
    return (
      <button
        data-testid="playback-time-display"
        onClick={() => {
          onSeek({ sec: 3, nsec: 0 });
        }}
      >
        time
      </button>
    );
  },
}));
jest.mock("./Scrubber", () => ({
  __esModule: true,
  default: function MockScrubber({ onSeek }: { onSeek: (seekTo: Time) => void }) {
    return (
      <button
        data-testid="scrubber"
        onClick={() => {
          onSeek({ sec: 2, nsec: 0 });
        }}
      >
        scrubber
      </button>
    );
  },
}));
jest.mock("./SeekStepControls", () => ({
  __esModule: true,
  default: function MockSeekStepControls() {
    return <div data-testid="seek-step-controls" />;
  },
  MIN_SEEK_STEP_MS: 1,
  MAX_SEEK_STEP_MS: 60 * 60 * 1000,
}));

function SpeedObserver(): React.JSX.Element {
  const speed = useWorkspaceStore((store) => store.playbackControls.speed);
  return <div data-testid="playback-speed">{speed}</div>;
}

function TimelineHeightObserver(): React.JSX.Element {
  const timelineHeight = useWorkspaceStore((store) => store.playbackControls.timelineHeight);
  return <div data-testid="timeline-height">{timelineHeight}</div>;
}

function KeyframeSearchLock({ active = true }: { active?: boolean }): ReactNull {
  const acquireKeyframeSearchLock = usePlaybackInteractionState(
    (store) => store.acquireKeyframeSearchLock,
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    return acquireKeyframeSearchLock({ isPlaying: false });
  }, [acquireKeyframeSearchLock, active]);

  return ReactNull;
}

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider
          value={
            {
              createEvent: {
                permission: () => false,
              },
            } as never
          }
        >
          <CoreDataProvider>
            <WorkspaceContextProvider
              disablePersistence
              initialState={{ playbackControls: { repeat: false, speed: 1 } }}
            >
              <PlaybackInteractionStateProvider>
                <MockMessagePipelineProvider>
                  {children}
                  <SpeedObserver />
                  <TimelineHeightObserver />
                </MockMessagePipelineProvider>
              </PlaybackInteractionStateProvider>
            </WorkspaceContextProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<PlaybackControls />", () => {
  it("adjusts playback speed with keyboard shortcuts", () => {
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          key: "+",
          shiftKey: true,
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("2");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Minus",
          key: "-",
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");
  });

  it("ignores playback speed shortcuts when ctrl or cmd is pressed", () => {
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          ctrlKey: true,
          key: "=",
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          key: "=",
          metaKey: true,
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");
  });

  it("disables play controls and ignores spacebar playback while keyframe search is active", () => {
    const play = jest.fn();
    const { container } = render(
      <Wrapper>
        <KeyframeSearchLock />
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={play}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    expect(container.querySelector<HTMLButtonElement>("#play-pause-button")?.disabled).toBe(true);
    jest.mocked(console.warn).mockClear();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Space",
          key: " ",
        }),
      );
    });

    expect(play).not.toHaveBeenCalled();
  });

  it("does not own playback pause while keyframe search is active", () => {
    const pause = jest.fn();

    render(
      <Wrapper>
        <KeyframeSearchLock />
        <PlaybackControls
          isPlaying
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={pause}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );
    jest.mocked(console.warn).mockClear();

    expect(pause).not.toHaveBeenCalled();
  });

  it("does not own playback resume after keyframe search ends", () => {
    const play = jest.fn();
    const pause = jest.fn();
    const renderControls = ({ active, isPlaying }: { active: boolean; isPlaying: boolean }) => (
      <Wrapper>
        <KeyframeSearchLock active={active} />
        <PlaybackControls
          isPlaying={isPlaying}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={play}
          pause={pause}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>
    );

    const { rerender } = render(renderControls({ active: true, isPlaying: true }));
    jest.mocked(console.warn).mockClear();

    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    rerender(renderControls({ active: true, isPlaying: false }));
    jest.mocked(console.warn).mockClear();
    expect(play).not.toHaveBeenCalled();

    rerender(renderControls({ active: false, isPlaying: false }));
    jest.mocked(console.warn).mockClear();
    expect(play).not.toHaveBeenCalled();
  });

  it("ignores seek and speed keyboard shortcuts while keyframe search is active", () => {
    const seek = jest.fn();
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({
            startTime: { sec: 0, nsec: 0 },
            endTime: { sec: 10, nsec: 0 },
            currentTime: { sec: 1, nsec: 0 },
          })}
          play={jest.fn()}
          pause={jest.fn()}
          seek={seek}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );
    jest.mocked(console.warn).mockClear();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "ArrowRight",
          key: "ArrowRight",
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "ArrowLeft",
          key: "ArrowLeft",
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          key: "+",
          shiftKey: true,
        }),
      );
    });

    expect(seek).not.toHaveBeenCalled();
    expect(screen.getByTestId("playback-speed").textContent).toBe("1");
  });

  it("blocks child seek callbacks while keyframe search is active", () => {
    const seek = jest.fn();
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({
            startTime: { sec: 0, nsec: 0 },
            endTime: { sec: 10, nsec: 0 },
            currentTime: { sec: 1, nsec: 0 },
          })}
          play={jest.fn()}
          pause={jest.fn()}
          seek={seek}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );
    jest.mocked(console.warn).mockClear();

    fireEvent.click(screen.getByTestId("scrubber"));
    fireEvent.click(screen.getByTestId("playback-time-display"));

    expect(seek).not.toHaveBeenCalled();
  });

  it("resizes the timeline and stores the height in the workspace", () => {
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    expect(screen.getByTestId("playback-controls").style.height).toBe("200px");
    expect(screen.getByTestId("timeline-height").textContent).toBe("200");

    act(() => {
      fireEvent(
        screen.getByTestId("playback-controls-resize-handle"),
        new MouseEvent("pointerdown", { bubbles: true, clientY: 200 }),
      );
    });
    act(() => {
      fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 150 }));
      fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(screen.getByTestId("playback-controls").style.height).toBe("250px");
    expect(screen.getByTestId("timeline-height").textContent).toBe("250");
  });
});
