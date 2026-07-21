/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { useContext, useEffect } from "react";

import { ContextInternal } from "@foxglove/studio-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import Scrubber from "./Scrubber";
import type { HoverOverEvent } from "./Slider";

type MockPipelineStore = NonNullable<React.ContextType<typeof ContextInternal>>;
type MockPipelineProps = {
  startTime: { sec: number; nsec: number };
  endTime: { sec: number; nsec: number };
  currentTime: { sec: number; nsec: number };
};
type MockSetPropsDispatch = (action: {
  type: "set-mock-props";
  mockProps: MockPipelineProps;
}) => void;

function dispatchMockPipelineProps(store: MockPipelineStore, mockProps: MockPipelineProps): void {
  (store.getState().dispatch as unknown as MockSetPropsDispatch)({
    type: "set-mock-props",
    mockProps,
  });
}

let mockSliderProps:
  | {
      disabled?: boolean;
      onChange?: (playbackSeconds: number) => void;
      onHoverOver?: (event: HoverOverEvent) => void;
      onHoverOut?: () => void;
    }
  | undefined;
let mockRenderPortalledEventsOverlay = false;
let mockShortcutsHelpButtonRenderCount = 0;

jest.mock("./EventsOverlay", () => {
  const { createPortal } = jest.requireActual<typeof import("react-dom")>("react-dom");

  return {
    EventsOverlay: function MockEventsOverlay(): React.JSX.Element {
      if (mockRenderPortalledEventsOverlay) {
        return createPortal(
          <input aria-label="Portalled event form input" />,
          globalThis.document.body,
        ) as React.JSX.Element;
      }

      return (
        <div
          data-testid="events-overlay"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        />
      );
    },
  };
});

jest.mock("./PlaybackBarHoverTicks", () => ({
  PlaybackBarHoverTicks: function MockPlaybackBarHoverTicks(): React.JSX.Element {
    return <div data-testid="playback-bar-hover-ticks" />;
  },
}));

jest.mock("./ProgressPlot", () => ({
  ProgressPlot: function MockProgressPlot({ loading }: { loading: boolean }): React.JSX.Element {
    return <div data-testid={loading ? "timeline-progress-loading" : "progress-plot"} />;
  },
}));

jest.mock("./Slider", () => ({
  __esModule: true,
  default: function MockSlider(props: {
    disabled?: boolean;
    onChange?: (playbackSeconds: number) => void;
    onHoverOver?: (event: HoverOverEvent) => void;
    onHoverOut?: () => void;
  }): React.JSX.Element {
    mockSliderProps = props;
    const { disabled } = props;
    return <div data-testid="scrubber-slider" data-disabled={String(disabled)} />;
  },
}));

jest.mock("./ShortcutsHelpButton", () => ({
  ShortcutsHelpButton: function MockShortcutsHelpButton(): React.JSX.Element {
    mockShortcutsHelpButtonRenderCount++;
    return <button aria-label="Keyboard shortcuts" />;
  },
}));

function SeedEventFeature({ enabled }: { enabled: boolean }): ReactNull {
  const setDataSource = useCoreData((store: CoreDataStore) => store.setDataSource);
  const setProject = useCoreData((store: CoreDataStore) => store.setProject);
  const setRecord = useCoreData((store: CoreDataStore) => store.setRecord);

  useEffect(() => {
    setDataSource(enabled ? { id: "coscene-data-platform", type: "connection" } : undefined);
    setProject({ loading: false, value: enabled ? ({ isArchived: false } as never) : undefined });
    setRecord({ loading: false, value: enabled ? ({ isArchived: false } as never) : undefined });
  }, [enabled, setDataSource, setProject, setRecord]);

  return ReactNull;
}

function MomentSubtitleStateProbe(): React.JSX.Element {
  const enabled = useWorkspaceStore(
    (store) =>
      (
        store.playbackControls as {
          momentSubtitle?: { enabled: boolean };
        }
      ).momentSubtitle?.enabled,
  );
  return <div data-testid="moment-subtitle-enabled">{String(enabled)}</div>;
}

function KeyframeSearchLock(): ReactNull {
  const acquireKeyframeSearchLock = usePlaybackInteractionState(
    (store) => store.acquireKeyframeSearchLock,
  );

  useEffect(() => {
    return acquireKeyframeSearchLock({ isPlaying: false });
  }, [acquireKeyframeSearchLock]);

  return ReactNull;
}

function MessagePipelineStoreProbe({
  onStore,
}: {
  onStore: (store: MockPipelineStore) => void;
}): ReactNull {
  const store = useContext(ContextInternal);

  useEffect(() => {
    if (store) {
      onStore(store);
    }
  }, [onStore, store]);

  return ReactNull;
}

function Wrapper({
  children,
  createEventAllowed = false,
  consoleApi,
  eventEnabled = false,
  updateEventAllowed = false,
}: React.PropsWithChildren<{
  createEventAllowed?: boolean;
  consoleApi?: React.ContextType<typeof CoSceneConsoleApiContext>;
  eventEnabled?: boolean;
  updateEventAllowed?: boolean;
}>): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider
          value={
            consoleApi ??
            ({
              createEvent: { permission: () => createEventAllowed },
              updateEvent: { permission: () => updateEventAllowed },
            } as never)
          }
        >
          <CoreDataProvider>
            <WorkspaceContextProvider disablePersistence>
              <MockMessagePipelineProvider
                startTime={{ sec: 0, nsec: 0 }}
                endTime={{ sec: 10, nsec: 0 }}
                currentTime={{ sec: 1, nsec: 0 }}
              >
                <PlaybackInteractionStateProvider>
                  <TimelineInteractionStateProvider>
                    <CoScenePlaylistProvider>
                      <EventsProvider>
                        <SeedEventFeature enabled={eventEnabled} />
                        {children}
                        <MomentSubtitleStateProbe />
                      </EventsProvider>
                    </CoScenePlaylistProvider>
                  </TimelineInteractionStateProvider>
                </PlaybackInteractionStateProvider>
              </MockMessagePipelineProvider>
            </WorkspaceContextProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<Scrubber />", () => {
  beforeEach(async () => {
    mockSliderProps = undefined;
    mockRenderPortalledEventsOverlay = false;
    mockShortcutsHelpButtonRenderCount = 0;
    await i18n.changeLanguage("en");
  });

  it("keeps the first moment lane at least 4px below the bag file bar", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const eventLaneLayerTop = Number.parseFloat(
      getComputedStyle(screen.getByTestId("event-lane-layer")).top,
    );

    expect(eventLaneLayerTop).toBeGreaterThanOrEqual(28);
  });

  it("does not reserve event-lane height when events are disabled", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const timelineContent = screen.getByTestId("timeline-content");
    expect(timelineContent.style.minHeight).toBe("26px");
    expect(getComputedStyle(timelineContent.parentElement!).overflowY).toBe("auto");
  });

  it("reserves only the rendered event-lane height when events are enabled", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("timeline-content").style.minHeight).toBe("58px");
    });
  });

  it("shows timeline loading while keyframe search is active", () => {
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(screen.getByTestId("timeline-progress-loading")).toBeTruthy();
  });

  it("disables the timeline slider while keyframe search is active", () => {
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(screen.getByTestId("scrubber-slider").dataset.disabled).toBe("true");
  });

  it("ignores timeline seek changes while keyframe search is active", () => {
    const onSeek = jest.fn();
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <Scrubber onSeek={onSeek} />
      </Wrapper>,
    );

    act(() => {
      mockSliderProps?.onChange?.(5);
    });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it("renders and toggles the moment subtitle button when events are enabled", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const subtitleButton = await screen.findByLabelText("Enable moment subtitles");

    expect(within(subtitleButton).getByTestId("moment-subtitle-icon-inactive")).toBeTruthy();
    expect(within(subtitleButton).queryByTestId("moment-subtitle-icon-active")).toBeNull();
    expect(screen.getByTestId("moment-subtitle-enabled").textContent).toBe("false");

    fireEvent.click(subtitleButton);

    expect(screen.getByTestId("moment-subtitle-enabled").textContent).toBe("true");
    expect(screen.getByLabelText("Disable moment subtitles")).toBeTruthy();
    expect(within(subtitleButton).getByTestId("moment-subtitle-icon-active")).toBeTruthy();
    expect(within(subtitleButton).queryByTestId("moment-subtitle-icon-inactive")).toBeNull();
  });

  it("keeps focus inside portalled event controls when they are clicked", () => {
    mockRenderPortalledEventsOverlay = true;
    const requestAnimationFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });

    try {
      render(
        <Wrapper eventEnabled>
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );

      const input = screen.getByRole("textbox", { name: "Portalled event form input" });
      input.focus();

      fireEvent.pointerDown(input, {
        clientX: 100,
        clientY: 20,
      });

      expect(document.activeElement).toBe(input);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it("shows the moment subtitle toggle without event write permission", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(await screen.findByLabelText("Enable moment subtitles")).toBeTruthy();
    expect(screen.queryByLabelText("Enable linked event adjustment")).toBeNull();
    expect(screen.queryByLabelText("Disable linked event adjustment")).toBeNull();
  });

  it("does not re-check event permissions when only playback time changes", async () => {
    const startTime = { sec: 0, nsec: 0 };
    const endTime = { sec: 10, nsec: 0 };
    const createPermission = jest.fn(() => true);
    const updatePermission = jest.fn(() => true);
    let pipelineStore: MockPipelineStore | undefined;

    render(
      <Wrapper
        consoleApi={
          {
            createEvent: { permission: createPermission },
            updateEvent: { permission: updatePermission },
          } as never
        }
        eventEnabled
      >
        <MessagePipelineStoreProbe
          onStore={(store) => {
            pipelineStore = store;
          }}
        />
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(createPermission).toHaveBeenCalled();
      expect(updatePermission).toHaveBeenCalled();
      expect(pipelineStore).toBeDefined();
    });

    createPermission.mockClear();
    updatePermission.mockClear();

    await act(async () => {
      dispatchMockPipelineProps(pipelineStore!, {
        startTime,
        endTime,
        currentTime: { sec: 2, nsec: 0 },
      });
      await Promise.resolve();
    });

    expect(createPermission).not.toHaveBeenCalled();
    expect(updatePermission).not.toHaveBeenCalled();
  });

  it("renders svg toolbar icons for event creation and linked event adjustment", async () => {
    render(
      <Wrapper eventEnabled createEventAllowed updateEventAllowed>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(await screen.findByTestId("event-create-icon")).toBeTruthy();
    expect(screen.getByTestId("rolling-edit-icon-active").tagName.toLowerCase()).toBe("span");

    fireEvent.click(screen.getByLabelText("Disable linked event adjustment"));

    expect(screen.getByTestId("rolling-edit-icon-inactive").tagName.toLowerCase()).toBe("span");
  });

  it("shows and hides the lightweight hover tooltip without relying on the slider subtree", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(mockSliderProps?.onHoverOver).toBeDefined();
    expect(screen.queryByTestId("timeline-hover-tooltip")).toBeNull();

    act(() => {
      mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 140, clientY: 60 });
    });

    const tooltip = screen.getByTestId("timeline-hover-tooltip");
    expect(tooltip).toBeTruthy();
    expect(tooltip.parentElement).toBe(document.body);
    expect(getComputedStyle(tooltip).left).toBe("0px");
    expect(getComputedStyle(tooltip).top).toBe("0px");
    expect(tooltip.style.transform).toContain("translate3d(140px, 60px, 0)");
    expect(within(tooltip).getByText("Elapsed")).toBeTruthy();
    expect(within(tooltip).getByText("00:00:02.00")).toBeTruthy();

    act(() => {
      mockSliderProps!.onHoverOut!();
    });

    expect(screen.queryByTestId("timeline-hover-tooltip")).toBeNull();
  });

  it("clamps the lightweight hover tooltip inside the viewport edges", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    const getBoundingClientRect = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRectMock(this: HTMLElement) {
        if (this.dataset.testid === "timeline-hover-tooltip") {
          return {
            bottom: 60,
            height: 60,
            left: 0,
            right: 200,
            top: 0,
            width: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      render(
        <Wrapper>
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );

      act(() => {
        mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 4, clientY: 200 });
      });

      expect(screen.getByTestId("timeline-hover-tooltip").style.transform).toContain(
        "translate3d(108px, 200px, 0)",
      );

      act(() => {
        mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 296, clientY: 200 });
      });

      expect(screen.getByTestId("timeline-hover-tooltip").style.transform).toContain(
        "translate3d(192px, 200px, 0)",
      );
    } finally {
      getBoundingClientRect.mockRestore();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("does not re-render toolbar actions for repeated timeline hover updates", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(mockSliderProps?.onHoverOver).toBeDefined();
    const initialShortcutRenderCount = mockShortcutsHelpButtonRenderCount;

    act(() => {
      mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 140, clientY: 60 });
      mockSliderProps!.onHoverOver!({ playbackSeconds: 3, clientX: 160, clientY: 60 });
      mockSliderProps!.onHoverOver!({ playbackSeconds: 4, clientX: 180, clientY: 60 });
    });

    expect(mockShortcutsHelpButtonRenderCount).toBe(initialShortcutRenderCount);
  });

  it("shows the lightweight hover tooltip when hovering the timeline content itself", async () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const timelineContent = screen.getByTestId("timeline-content");
    jest.spyOn(timelineContent, "getBoundingClientRect").mockReturnValue({
      bottom: 120,
      height: 90,
      left: 100,
      right: 300,
      top: 30,
      width: 200,
      x: 100,
      y: 30,
      toJSON: () => ({}),
    });

    act(() => {
      fireEvent(
        timelineContent,
        new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 60 }),
      );
    });

    const tooltip = await screen.findByTestId("timeline-hover-tooltip");
    expect(tooltip.style.transform).toContain("translate3d(200px, 35px, 0)");
  });

  it("clears the lightweight hover tooltip when an event drag leaves the timeline", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const timelineContent = screen.getByTestId("timeline-content");
    jest.spyOn(timelineContent, "getBoundingClientRect").mockReturnValue({
      bottom: 120,
      height: 90,
      left: 100,
      right: 300,
      top: 30,
      width: 200,
      x: 100,
      y: 30,
      toJSON: () => ({}),
    });

    const eventsOverlay = screen.getByTestId("events-overlay");

    act(() => {
      fireEvent(
        eventsOverlay,
        new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 60 }),
      );
    });

    expect(await screen.findByTestId("timeline-hover-tooltip")).toBeTruthy();

    act(() => {
      fireEvent(
        eventsOverlay,
        new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 60 }),
      );
      fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 140 }));
    });

    expect(screen.queryByTestId("timeline-hover-tooltip")).toBeNull();
  });
});
