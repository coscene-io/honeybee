/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { useContext, useEffect } from "react";

import { ContextInternal } from "@foxglove/studio-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useEvents } from "@foxglove/studio-base/context/EventsContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { useTimelineInteractionState } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { CustomFieldSchemaSchema } from "@foxglove/studio-base/services/api/moment-custom-field/generated/common/custom_field_pb";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import Scrubber from "./Scrubber";
import type { HoverOverEvent } from "./Slider";
import { zoomViewportAtTime, type TimelineViewport } from "./timelineViewport";

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
      cursor?: string;
      viewport?: TimelineViewport;
      onChange?: (playbackSeconds: number) => void;
      onHoverOver?: (event: HoverOverEvent) => void;
      onHoverOut?: () => void;
    }
  | undefined;
let mockEventsOverlayProps:
  | React.ComponentProps<typeof import("./EventsOverlay").EventsOverlay>
  | undefined;
let mockRenderPortalledEventsOverlay = false;
let mockShortcutsHelpButtonRenderCount = 0;

jest.mock("./EventsOverlay", () => {
  const { createPortal } = jest.requireActual<typeof import("react-dom")>("react-dom");

  return {
    EventsOverlay: function MockEventsOverlay(
      props: NonNullable<typeof mockEventsOverlayProps>,
    ): React.JSX.Element {
      mockEventsOverlayProps = props;
      if (mockRenderPortalledEventsOverlay) {
        return createPortal(
          <input aria-label="Portalled event form input" />,
          globalThis.document.body,
        );
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
    cursor?: string;
    viewport?: TimelineViewport;
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

function SeedSettingsProject({ loading = false }: { loading?: boolean }): ReactNull {
  const setProject = useCoreData((store) => store.setProject);
  const setOrganization = useCoreData((store) => store.setOrganization);
  useEffect(() => {
    setProject({ loading, value: { slug: "project", isArchived: false } as never });
    setOrganization({ loading: false, value: { slug: "organization" } as never });
  }, [loading, setOrganization, setProject]);
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
              deleteEvent: { permission: () => false },
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

  it("aligns group names and moment lanes directly below the compact ruler", () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const eventLaneLayerTop = Number.parseFloat(
      getComputedStyle(screen.getByTestId("event-lane-layer")).top,
    );

    expect(eventLaneLayerTop).toBe(20);
    const trackList = screen.getByTestId("moment-track-list").parentElement!;
    expect(Number.parseFloat(getComputedStyle(trackList).top)).toBe(eventLaneLayerTop);
    expect(trackList.parentElement?.firstElementChild).toBe(trackList);
  });

  it.each([
    { eventEnabled: true, canRead: true, loading: false, visible: true },
    { eventEnabled: true, canRead: false, loading: false, visible: false },
    { eventEnabled: true, canRead: true, loading: true, visible: false },
    { eventEnabled: false, canRead: true, loading: false, visible: false },
  ])(
    "scopes the rules link to the readable project (%j)",
    ({ eventEnabled, canRead, loading, visible }) => {
      render(
        <Wrapper
          eventEnabled={eventEnabled}
          consoleApi={
            {
              createEvent: { permission: () => false },
              updateEvent: { permission: () => false },
              deleteEvent: { permission: () => false },
              getMomentCustomFieldSchema: { permission: () => canRead },
            } as never
          }
        >
          <SeedSettingsProject loading={loading} />
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );
      fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
      const link = screen.queryByRole("link", { name: "Moment grouping and tracks" });
      expect(link != undefined).toBe(visible);
      if (visible) {
        expect(link?.getAttribute("href")).toBe(
          "https://dev.coscene.cn/organization/project/manage/advanced-settings/custom-field/moment-custom-field?momentRules=1",
        );
      }
    },
  );

  it.each(["blur", "pointercancel", "pointerup"])(
    "stops resizing the track column after %s",
    (eventType) => {
      render(
        <Wrapper eventEnabled>
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );
      const resizer = screen.getByTestId("moment-track-resizer");
      jest
        .spyOn(resizer.parentElement!, "getBoundingClientRect")
        .mockReturnValue(DOMRect.fromRect({ width: 220 }));
      fireEvent(resizer, new MouseEvent("pointerdown", { bubbles: true, clientX: 220 }));
      fireEvent(window, new MouseEvent("pointermove", { clientX: 260 }));
      expect(resizer.getAttribute("aria-valuenow")).toBe("260");
      fireEvent(window, new Event(eventType));
      fireEvent(window, new MouseEvent("pointermove", { clientX: 300 }));
      expect(resizer.getAttribute("aria-valuenow")).toBe("260");
    },
  );

  describe("queued wheel viewport updates", () => {
    let frames: Map<number, FrameRequestCallback>;
    beforeEach(() => {
      frames = new Map();
      let id = 0;
      jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.set(++id, callback);
        return id;
      });
      jest.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
        frames.delete(frame);
      });
    });
    const flushFrames = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      act(() => {
        callbacks.forEach((callback) => {
          callback(0);
        });
      });
    };
    const getScrubber = () => {
      const scrubber = screen
        .getByTestId("timeline-content")
        .closest<HTMLElement>("[data-timeline-scrubber]")!;
      jest
        .spyOn(screen.getByTestId("timeline-content"), "getBoundingClientRect")
        .mockReturnValue(DOMRect.fromRect({ width: 1000, height: 200 }));
      return scrubber;
    };

    it.each(["reset", "slider", "keyboard", "scrollbar"])(
      "does not overwrite a later %s action with an older wheel update",
      (action) => {
        render(
          <Wrapper>
            <Scrubber onSeek={jest.fn()} />
          </Wrapper>,
        );
        const scrubber = getScrubber();
        fireEvent.change(screen.getByRole("slider", { name: "Timeline zoom" }), {
          target: { value: 40 },
        });
        const before = mockSliderProps!.viewport;
        fireEvent.wheel(scrubber, { ctrlKey: true, deltaY: -200, clientX: 500 });
        expect(mockSliderProps!.viewport).toEqual(before);
        switch (action) {
          case "reset":
            fireEvent.click(screen.getByRole("button", { name: "Zoom to fit" }));
            break;
          case "slider":
            fireEvent.change(screen.getByRole("slider", { name: "Timeline zoom" }), {
              target: { value: 70 },
            });
            break;
          case "keyboard":
            act(() => {
              scrubber.focus();
            });
            fireEvent.keyDown(scrubber, { key: "=", code: "Equal", ctrlKey: true, keyCode: 187 });
            break;
          case "scrollbar":
            fireEvent.keyDown(screen.getByRole("scrollbar"), { key: "ArrowRight" });
            break;
        }
        const newerViewport = mockSliderProps!.viewport;
        expect(newerViewport).not.toEqual(before);
        flushFrames();
        expect(mockSliderProps!.viewport).toEqual(newerViewport);
      },
    );

    it("accumulates consecutive wheel inputs into a single frame", () => {
      render(
        <Wrapper>
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );
      const scrubber = getScrubber();
      const before = mockSliderProps!.viewport!;
      fireEvent.wheel(scrubber, { ctrlKey: true, deltaY: -100, clientX: 500 });
      fireEvent.wheel(scrubber, { ctrlKey: true, deltaY: -200, clientX: 500 });
      expect(mockSliderProps!.viewport).toBe(before);
      expect(frames.size).toBe(1);
      flushFrames();
      const expected = zoomViewportAtTime(before, 5, -300);
      expect(mockSliderProps!.viewport!.visibleStartSec).toBeCloseTo(expected.visibleStartSec);
      expect(mockSliderProps!.viewport!.visibleEndSec).toBeCloseTo(expected.visibleEndSec);
    });

    it("cancels pending wheel input on unmount", () => {
      const { unmount } = render(
        <Wrapper>
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );
      fireEvent.wheel(getScrubber(), { ctrlKey: true, deltaY: -200, clientX: 500 });
      expect(frames.size).toBe(1);
      unmount();
      expect(frames.size).toBe(0);
    });

    it("does not overwrite playback auto-follow with a queued wheel update", () => {
      let pipeline: MockPipelineStore | undefined;
      render(
        <Wrapper>
          <MessagePipelineStoreProbe
            onStore={(store) => {
              pipeline = store;
            }}
          />
          <Scrubber onSeek={jest.fn()} />
        </Wrapper>,
      );
      const scrubber = getScrubber();
      fireEvent.change(screen.getByRole("slider", { name: "Timeline zoom" }), {
        target: { value: 40 },
      });
      fireEvent.wheel(scrubber, { ctrlKey: true, deltaY: -200, clientX: 500 });
      act(() => {
        const activeData = pipeline!.getState().public.playerState.activeData!;
        dispatchMockPipelineProps(pipeline!, {
          startTime: activeData.startTime,
          endTime: activeData.endTime,
          currentTime: { sec: 9, nsec: 0 },
        });
      });
      const followed = mockSliderProps!.viewport!;
      expect(followed.visibleStartSec).toBeGreaterThan(1);
      flushFrames();
      expect(mockSliderProps!.viewport).toEqual(followed);
    });
  });

  it("lets pointer events pass through the shared file and progress strip", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );
    expect(getComputedStyle(screen.getByTestId("timeline-file-layer")).pointerEvents).toBe("none");
  });

  it("does not reserve event-lane height when events are disabled", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const timelineContent = screen.getByTestId("timeline-content");
    expect(timelineContent.style.minHeight).toBe("20px");
    expect(
      getComputedStyle(timelineContent.closest("[data-timeline-scroll-container]")!).overflowY,
    ).toBe("auto");
  });

  it("reserves only the rendered event-lane height when events are enabled", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("timeline-content").style.minHeight).toBe("48px");
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

  it("uses the default cursor for the timeline slider", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(mockSliderProps?.cursor).toBe("default");
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
            deleteEvent: { permission: () => false },
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
  it.each(["pointerout", "mouseout", "blur", "visibilitychange"])(
    "dismisses visible and pending timeline hover on %s and allows hovering again",
    (eventType) => {
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrameId = 0;
      const requestFrame = jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        const id = ++nextFrameId;
        frames.set(id, cb);
        return id;
      });
      const cancelFrame = jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
        frames.delete(id);
      });
      const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

      try {
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
        const move = () => {
          fireEvent(
            timelineContent,
            new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 60 }),
          );
        };
        const flushFrames = () => {
          const callbacks = [...frames.values()];
          frames.clear();
          callbacks.forEach((cb) => {
            cb(performance.now());
          });
        };

        act(() => {
          mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 140, clientY: 60 });
          move();
        });
        expect(screen.getByTestId("timeline-hover-tooltip")).toBeTruthy();

        act(() => {
          if (eventType === "visibilitychange") {
            visibility.mockReturnValue("hidden");
            fireEvent(document, new Event(eventType));
          } else if (eventType === "blur") {
            fireEvent(window, new Event(eventType));
          } else {
            // A fast viewport exit may skip the timeline's own leave handler.
            fireEvent(document, new MouseEvent(eventType, { bubbles: true }));
          }
        });
        expect(screen.queryByTestId("timeline-hover-tooltip")).toBeNull();
        act(flushFrames);
        expect(screen.queryByTestId("timeline-hover-tooltip")).toBeNull();

        visibility.mockReturnValue("visible");
        act(move);
        act(flushFrames);
        expect(screen.getByTestId("timeline-hover-tooltip")).toBeTruthy();
      } finally {
        requestFrame.mockRestore();
        cancelFrame.mockRestore();
        visibility.mockRestore();
      }
    },
  );

  it("keeps timeline hover visible for transitions inside the document and visible-page events", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );
    act(() => {
      mockSliderProps!.onHoverOver!({ playbackSeconds: 2, clientX: 140, clientY: 60 });
      fireEvent(
        document,
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(screen.getByTestId("timeline-hover-tooltip")).toBeTruthy();
  });
});

it("focuses the Moment viewport without moving playback and fit restores the full recording", () => {
  const seek = jest.fn();
  render(
    <Wrapper eventEnabled>
      <Scrubber onSeek={seek} />
    </Wrapper>,
  );
  act(() => {
    mockEventsOverlayProps?.onFocusEvent?.({
      startTime: { sec: 4, nsec: 0 },
      endTime: { sec: 6, nsec: 0 },
    } as never);
  });
  expect(mockSliderProps?.viewport?.visibleStartSec).toBe(3.5);
  expect(mockSliderProps?.viewport?.visibleEndSec).toBe(6.5);
  expect(seek).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Zoom to fit" }));
  expect(mockSliderProps?.viewport?.visibleStartSec).toBe(0);
  expect(mockSliderProps?.viewport?.visibleEndSec).toBe(10);
});

function SidebarFocusFixture(): React.JSX.Element {
  const setEvents = useEvents((store) => store.setEvents);
  const requestFocus = useTimelineInteractionState((store) => store.setEventToFocus);
  const pending = useTimelineInteractionState((store) => store.eventToFocus);
  return (
    <>
      <button
        onClick={() => {
          const event = {
            ...makeMomentFixture(1, "short", { sec: 0, nsec: 0 })[0]!,
            startTime: { sec: 4, nsec: 0 },
            endTime: { sec: 6, nsec: 0 },
            secondsSinceStart: 4,
          };
          setEvents({ loading: false, value: [event] });
          requestFocus(event);
        }}
      >
        Focus sidebar fixture
      </button>
      <span data-testid="pending-sidebar-focus">{pending?.event.name ?? "none"}</span>
    </>
  );
}

it("consumes a sidebar focus request through the shared store without seeking", () => {
  const seek = jest.fn();
  render(
    <Wrapper eventEnabled>
      <Scrubber onSeek={seek} />
      <SidebarFocusFixture />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Focus sidebar fixture" }));
  expect(mockSliderProps?.viewport?.visibleStartSec).toBe(3.5);
  expect(mockSliderProps?.viewport?.visibleEndSec).toBe(6.5);
  expect(screen.getByTestId("pending-sidebar-focus").textContent).toBe("none");
  expect(seek).not.toHaveBeenCalled();
});

function ProjectScopedTracksFixture(): ReactNull {
  const setEvents = useEvents((store) => store.setEvents);
  const setSchema = useEvents((store) => store.setCustomFieldSchema);
  useEffect(() => {
    const owner = "warehouses/one/projects/active";
    const events = Array.from(
      { length: 2 },
      () => makeMomentFixture(1, "short", { sec: 0, nsec: 0 })[0]!,
    );
    events[0]!.event.name = `${owner}/events/local`;
    events[1]!.event.name = "warehouses/one/projects/other/events/foreign";
    for (const entry of events) {
      entry.event.customFieldValues = [
        create(CustomFieldValueSchema, {
          property: { id: "platform" },
          value: { case: "enums", value: { id: "a" } },
        }),
      ];
    }
    setEvents({ loading: false, value: events });
    setSchema(
      create(CustomFieldSchemaSchema, {
        properties: [
          { id: "platform", type: { case: "enums", value: { values: { a: "Alpha" } } } },
        ],
        groupingRules: [{ propertyId: "platform" }],
      }),
      owner,
    );
  }, [setEvents, setSchema]);
  return ReactNull;
}

it("renders foreign-project Moments outside the active schema's groups", () => {
  render(
    <Wrapper eventEnabled>
      <Scrubber onSeek={jest.fn()} />
      <ProjectScopedTracksFixture />
    </Wrapper>,
  );
  const tracks = mockEventsOverlayProps!.trackOptions!.tracks;
  expect(tracks.find((track) => track.kind === "value")?.count).toBe(1);
  expect(tracks.find((track) => track.kind === "ungrouped")?.events[0]?.event.name).toBe(
    "warehouses/one/projects/other/events/foreign",
  );
  expect(screen.getAllByTestId("moment-track-title")).toHaveLength(2);
});

it("hides and restores a project track without seeking or removing its source Moments", () => {
  const seek = jest.fn();
  render(
    <Wrapper eventEnabled>
      <Scrubber onSeek={seek} />
      <ProjectScopedTracksFixture />
    </Wrapper>,
  );
  const tracks = mockEventsOverlayProps!.trackOptions!.tracks;
  expect(mockEventsOverlayProps!.trackLayout!.items).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Hide track Alpha" }));
  expect(mockEventsOverlayProps!.trackLayout!.items.map((item) => item.event.event.name)).toEqual([
    "warehouses/one/projects/other/events/foreign",
  ]);
  expect(mockEventsOverlayProps!.trackOptions!.tracks).toBe(tracks);
  expect(screen.getByText("Alpha (1)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show track Alpha" }));
  expect(mockEventsOverlayProps!.trackLayout!.items).toHaveLength(2);
  expect(seek).not.toHaveBeenCalled();
});
