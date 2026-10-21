/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import type { Time } from "@foxglove/rostime";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import type { RealtimeHistoryState } from "@foxglove/studio-base/players/types";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import PlaybackControls, { RealtimeVizPlaybackControls } from ".";

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
  default: function MockScrubber({
    onSeek,
    playback,
    playbackOptions,
    seekStep,
    speed,
    time,
    sourceInfo,
  }: React.ComponentProps<typeof import("./Scrubber").default>) {
    return (
      <>
        <div>
          {playback}
          {playbackOptions}
          {seekStep}
          {speed}
          {time?.({ compact: false })}
          {sourceInfo}
        </div>
        <button
          data-testid="scrubber"
          onClick={() => {
            onSeek({ sec: 2, nsec: 0 });
          }}
        >
          scrubber
        </button>
      </>
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

function Wrapper({
  children,
  realtimeHistory,
  timelineHeight = 200,
}: React.PropsWithChildren<{
  realtimeHistory?: RealtimeHistoryState;
  timelineHeight?: number;
}>): React.JSX.Element {
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
              initialState={{ playbackControls: { repeat: false, speed: 1, timelineHeight } }}
            >
              <PlaybackInteractionStateProvider>
                <MockMessagePipelineProvider realtimeHistory={realtimeHistory}>
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
  it("leaves Space to the focused group button while retaining the global playback shortcut", () => {
    const play = jest.fn();
    const toggle = jest.fn();
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={play}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
        <div data-moment-track-controls>
          <button onClick={toggle}>Toggle group</button>
        </div>
      </Wrapper>,
    );
    const button = screen.getByRole("button", { name: "Toggle group" });
    const key = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
      code: "Space",
    });
    fireEvent(button, key);
    expect(key.defaultPrevented).toBe(false);
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: " ", code: "Space" });
    expect(play).toHaveBeenCalledTimes(1);
  });

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

    expect(screen.getByTestId("playback-speed").textContent).toBe("1.5");

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
  it.each([500, 1000])("caps pointer resizing at 80%% of a %ipx viewport", (viewportHeight) => {
    jest.replaceProperty(window, "innerHeight", viewportHeight);
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

    const root = screen.getByTestId("playback-controls");
    const handle = screen.getByTestId("playback-controls-resize-handle");

    expect(root.style.height).toBe("200px");

    act(() => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 200 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: -1000 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientY: -1000 }));
    });
    expect(root.style.height).toBe(`${viewportHeight * 0.8}px`);
    expect(handle.getAttribute("aria-valuemax")).toBe(`${viewportHeight * 0.8}`);
    expect(getComputedStyle(root).maxHeight).toBe("80vh");

    act(() => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 40 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 2000 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientY: 2000 }));
    });
    expect(root.style.height).toBe("126px");
  });

  it("caps keyboard resizing at the viewport limit", () => {
    jest.replaceProperty(window, "innerHeight", 1000);
    render(
      <Wrapper timelineHeight={795}>
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

    const root = screen.getByTestId("playback-controls");
    const handle = screen.getByRole("separator", { name: "Timeline height" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(root.style.height).toBe("800px");
    expect(handle.getAttribute("aria-valuenow")).toBe("800");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(root.style.height).toBe("790px");
  });

  it("reclamps saved height and immediately follows the pointer after the viewport shrinks", async () => {
    jest.replaceProperty(window, "innerHeight", 500);
    render(
      <Wrapper timelineHeight={780}>
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

    const root = screen.getByTestId("playback-controls");
    const handle = screen.getByRole("separator", { name: "Timeline height" });
    expect(root.style.height).toBe("400px");

    jest.replaceProperty(window, "innerHeight", 1000);
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(root.style.height).toBe("780px");
    });

    act(() => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 200 }));
    });
    jest.replaceProperty(window, "innerHeight", 500);
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(root.style.height).toBe("400px");
      expect(handle.getAttribute("aria-valuemax")).toBe("400");
      expect(handle.getAttribute("aria-valuenow")).toBe("400");
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 210 }));
    });
    expect(root.style.height).toBe("390px");

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 220 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 230 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientY: 230 }));
    });
    expect(root.style.height).toBe("370px");
    expect(handle.getAttribute("aria-valuenow")).toBe("370");
  });

  it("follows the visible saved height when the viewport grows during a drag", async () => {
    jest.replaceProperty(window, "innerHeight", 500);
    render(
      <Wrapper timelineHeight={780}>
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

    const root = screen.getByTestId("playback-controls");
    const handle = screen.getByRole("separator", { name: "Timeline height" });
    expect(root.style.height).toBe("400px");
    act(() => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 200 }));
    });

    jest.replaceProperty(window, "innerHeight", 1000);
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(root.style.height).toBe("780px");
      expect(handle.getAttribute("aria-valuemax")).toBe("800");
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 210 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientY: 210 }));
    });
    expect(root.style.height).toBe("770px");
  });

  it("keeps the viewport cap even when it is below the usual minimum height", () => {
    jest.replaceProperty(window, "innerHeight", 150);
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

    const root = screen.getByTestId("playback-controls");
    const handle = screen.getByRole("separator", { name: "Timeline height" });
    expect(root.style.height).toBe("120px");
    expect(getComputedStyle(root).minHeight).toBe("min(126px, 80vh)");
    expect(handle.getAttribute("aria-valuemin")).toBe("120");
    expect(handle.getAttribute("aria-valuemax")).toBe("120");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(root.style.height).toBe("120px");
  });
});

describe("<RealtimeVizPlaybackControls />", () => {
  it("shows the preparing prompt before the current player reports cache state", async () => {
    render(
      <Wrapper>
        <RealtimeVizPlaybackControls />
      </Wrapper>,
    );

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Switch to playback mode",
    });
    fireEvent.mouseOver(button.parentElement!);

    expect(
      await screen.findByText("Playback will be available after the first message is cached."),
    ).toBeTruthy();
  });

  it("disables replay when the current player did not create a cache", () => {
    render(
      <Wrapper realtimeHistory={{ status: "disabled", retentionWindowMs: 0 }}>
        <RealtimeVizPlaybackControls />
      </Wrapper>,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Switch to playback mode" }).disabled,
    ).toBe(true);
  });

  it("enables replay only after the current player has cached data", () => {
    render(
      <Wrapper realtimeHistory={{ status: "ready", retentionWindowMs: 30_000 }}>
        <RealtimeVizPlaybackControls />
      </Wrapper>,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Switch to playback mode" }).disabled,
    ).toBe(false);
  });
});
