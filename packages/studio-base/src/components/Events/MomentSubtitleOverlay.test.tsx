/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { useEffect } from "react";

import { add } from "@foxglove/rostime";
import {
  MOMENT_SUBTITLE_DEFAULT_FONT_SIZE_PX,
  MomentSubtitleOverlay,
} from "@foxglove/studio-base/components/Events/MomentSubtitleOverlay";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import {
  type EventsStore,
  type TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

type MomentSubtitleSettings = {
  enabled: boolean;
  fontSize: number;
  position: undefined | { anchorX: number; bottom: number };
};

function makePositionedEvent(
  displayName: string,
  startOffsetSec: number,
  durationSec: number,
): TimelinePositionedEvent {
  const startTime = { sec: 100 + startOffsetSec, nsec: 0 };
  const endTime = add(startTime, { sec: durationSec, nsec: 0 });

  return {
    event: create(EventSchema, {
      name: `events/${displayName}`,
      displayName,
      duration: create(DurationSchema, {
        seconds: BigInt(durationSec),
        nanos: 0,
      }),
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(startTime.sec),
        nanos: 0,
      }),
    }),
    color: "#00ADEF",
    startTime,
    endTime,
    startPosition: startOffsetSec / 10,
    endPosition: (startOffsetSec + durationSec) / 10,
    secondsSinceStart: startOffsetSec,
  };
}

function SeedEvents({ events }: { events: TimelinePositionedEvent[] }): ReactNull {
  const setEvents = useEvents((store: EventsStore) => store.setEvents);

  useEffect(() => {
    setEvents({ loading: false, value: events });
  }, [events, setEvents]);

  return ReactNull;
}

function renderMomentSubtitleOverlay({
  currentSec = 101,
  momentSubtitle = {
    enabled: true,
    fontSize: MOMENT_SUBTITLE_DEFAULT_FONT_SIZE_PX,
    position: undefined,
  },
  events = [makePositionedEvent("Pickup failed", 0, 3)],
}: {
  currentSec?: number;
  momentSubtitle?: MomentSubtitleSettings;
  events?: TimelinePositionedEvent[];
} = {}): void {
  render(
    <ThemeProvider isDark>
      <WorkspaceContextProvider
        disablePersistence
        initialState={
          {
            playbackControls: {
              repeat: false,
              rollingEditEnabled: true,
              speed: 1,
              timelineHeight: 200,
              momentSubtitle,
            },
          } as never
        }
      >
        <EventsProvider>
          <MockMessagePipelineProvider
            startTime={{ sec: 100, nsec: 0 }}
            currentTime={{ sec: currentSec, nsec: 0 }}
            endTime={{ sec: 110, nsec: 0 }}
          >
            <SeedEvents events={events} />
            <MomentSubtitleOverlay />
          </MockMessagePipelineProvider>
        </EventsProvider>
      </WorkspaceContextProvider>
    </ThemeProvider>,
  );
}

describe("<MomentSubtitleOverlay />", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  });

  it("renders the active event displayName as a subtitle", () => {
    renderMomentSubtitleOverlay();

    expect(screen.getByTestId("moment-subtitle").textContent).toBe("Pickup failed");
  });

  it("hides the subtitle when disabled or outside an event range", () => {
    renderMomentSubtitleOverlay({
      momentSubtitle: {
        enabled: false,
        fontSize: MOMENT_SUBTITLE_DEFAULT_FONT_SIZE_PX,
        position: undefined,
      },
    });

    expect(screen.queryByTestId("moment-subtitle")).toBeNull();

    cleanup();
    renderMomentSubtitleOverlay({ currentSec: 105 });

    expect(screen.queryByText("Pickup failed")).toBeNull();
  });

  it("orders overlapping event subtitles by timeline lane", () => {
    renderMomentSubtitleOverlay({
      currentSec: 101,
      events: [makePositionedEvent("Lane 0", 0, 5), makePositionedEvent("Lane 1", 1, 1)],
    });

    const lines = within(screen.getByTestId("moment-subtitle")).getAllByTestId(
      "moment-subtitle-line",
    );
    expect(lines.map((line) => line.textContent)).toEqual(["Lane 0", "Lane 1"]);
  });

  it("adjusts subtitle font size and disables controls at the limits", () => {
    renderMomentSubtitleOverlay();

    fireEvent.mouseEnter(screen.getByTestId("moment-subtitle-container"));
    fireEvent.click(screen.getByRole("button", { name: "Increase subtitle font size" }));

    expect(screen.getByTestId("moment-subtitle").style.fontSize).toBe("20px");

    fireEvent.click(screen.getByRole("button", { name: "Decrease subtitle font size" }));
    expect(screen.getByTestId("moment-subtitle").style.fontSize).toBe("16px");

    cleanup();
    renderMomentSubtitleOverlay({
      momentSubtitle: { enabled: true, fontSize: 12, position: undefined },
    });
    fireEvent.mouseEnter(screen.getByTestId("moment-subtitle-container"));
    expect(
      screen.getByRole("button", { name: "Decrease subtitle font size" }).getAttribute("disabled"),
    ).not.toBeNull();

    cleanup();
    renderMomentSubtitleOverlay({
      momentSubtitle: { enabled: true, fontSize: 56, position: undefined },
    });
    fireEvent.mouseEnter(screen.getByTestId("moment-subtitle-container"));
    expect(
      screen.getByRole("button", { name: "Increase subtitle font size" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("keeps controls visible while moving from the subtitle to the controls", () => {
    jest.useFakeTimers();

    try {
      renderMomentSubtitleOverlay();

      const container = screen.getByTestId("moment-subtitle-container");
      fireEvent.mouseEnter(container);

      expect(container.getAttribute("data-controls-visible")).toBe("true");

      fireEvent.mouseLeave(container);
      expect(container.getAttribute("data-controls-visible")).toBe("true");

      act(() => {
        jest.advanceTimersByTime(199);
      });
      expect(container.getAttribute("data-controls-visible")).toBe("true");

      fireEvent.mouseEnter(screen.getByTestId("moment-subtitle-controls"));
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(container.getAttribute("data-controls-visible")).toBe("true");

      fireEvent.mouseLeave(screen.getByTestId("moment-subtitle-controls"));
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(container.getAttribute("data-controls-visible")).toBe("false");
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps controls visible while keyboard focus remains within the overlay", () => {
    jest.useFakeTimers();

    try {
      renderMomentSubtitleOverlay();

      const container = screen.getByTestId("moment-subtitle-container");
      const subtitle = screen.getByTestId("moment-subtitle");

      fireEvent.keyDown(container, { key: "Tab" });
      fireEvent.focus(subtitle);

      expect(container.getAttribute("data-controls-visible")).toBe("true");

      fireEvent.mouseLeave(container);
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(container.getAttribute("data-controls-visible")).toBe("true");

      fireEvent.blur(subtitle, { relatedTarget: document.body });

      expect(container.getAttribute("data-controls-visible")).toBe("false");
    } finally {
      jest.useRealTimers();
    }
  });

  it("drags the subtitle and resets it to the default position", () => {
    renderMomentSubtitleOverlay();

    const container = screen.getByTestId("moment-subtitle-container");
    const subtitle = screen.getByTestId("moment-subtitle");
    subtitle.getBoundingClientRect = () =>
      ({
        bottom: 520,
        height: 40,
        left: 300,
        right: 500,
        top: 480,
        width: 200,
        x: 300,
        y: 480,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseEnter(container);
    expect(
      screen.getByRole("button", { name: "Reset subtitle position" }).getAttribute("disabled"),
    ).not.toBeNull();

    act(() => {
      subtitle.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 400,
          clientY: 500,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 450 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 500, clientY: 450 }));
    });

    expect(container.style.left).toBe("62.5%");
    expect(container.style.bottom).toBe("130px");
    expect(
      screen.getByRole("button", { name: "Reset subtitle position" }).getAttribute("disabled"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset subtitle position" }));

    expect(container.style.left).toBe("50%");
    expect(container.style.bottom).toBe("80px");
    expect(
      screen.getByRole("button", { name: "Reset subtitle position" }).getAttribute("disabled"),
    ).not.toBeNull();
  });
});
