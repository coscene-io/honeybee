/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";
import { PropsWithChildren } from "react";

import { compare } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext, {
  AppConfigurationValue,
  IAppConfiguration,
} from "@foxglove/studio-base/context/AppConfigurationContext";
import type { MessageAndData } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  MessageEvent,
  SubscribeMessageRange,
  Topic,
} from "@foxglove/studio-base/players/types";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { useFrameNavigation } from "./useFrameNavigation";

const mockEnqueueSnackbar = jest.fn();

jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}));

const path = "/topic{value==1}.value";

const topics: Topic[] = [{ name: "/topic", schemaName: "datatype" }];
const datatypes: RosDatatypes = new Map(
  Object.entries({
    datatype: {
      definitions: [{ name: "value", type: "uint32", isArray: false, isComplex: false }],
    },
  }),
);

class FakeAppConfiguration implements IAppConfiguration {
  #values = new Map<string, AppConfigurationValue>();

  public constructor(values: Iterable<readonly [string, AppConfigurationValue]> = []) {
    this.#values = new Map(values);
  }

  public get(key: string): AppConfigurationValue {
    return this.#values.get(key);
  }

  public async set(key: string, value: AppConfigurationValue): Promise<void> {
    this.#values.set(key, value);
  }

  public addChangeListener() {}

  public removeChangeListener() {}
}

function time(sec: number, nsec = 0): Time {
  return { sec, nsec };
}

function message(sec: number, value: number): MessageEvent {
  return {
    topic: "/topic",
    receiveTime: time(sec),
    message: { value },
    schemaName: "datatype",
    sizeInBytes: 0,
  };
}

function queriedValue(messageEvent: MessageEvent): number {
  const payload = messageEvent.message;
  if (typeof payload === "object" && payload != undefined && "value" in payload) {
    const value = payload.value;
    if (typeof value === "number") {
      return value;
    }
  }
  throw new Error("Expected test message to have a numeric value");
}

function messageAndData(messageEvent: MessageEvent): MessageAndData {
  return {
    messageEvent,
    queriedData: [{ path, value: queriedValue(messageEvent) }],
  };
}

function inRange(messageEvent: MessageEvent, start: Time, end: Time): boolean {
  return compare(messageEvent.receiveTime, start) >= 0 && compare(messageEvent.receiveTime, end) <= 0;
}

function makeSubscribeMessageRange(
  messages: readonly MessageEvent[],
): jest.Mock<ReturnType<SubscribeMessageRange>, Parameters<SubscribeMessageRange>> {
  return jest.fn<ReturnType<SubscribeMessageRange>, Parameters<SubscribeMessageRange>>(
    ({ timeRange, onNewRangeIterator }) => {
      const rangeMessages = messages.filter((rangeMessage) =>
        inRange(rangeMessage, timeRange.start, timeRange.end),
      );
      void onNewRangeIterator(
        (async function* () {
          yield rangeMessages;
        })(),
      );
      return jest.fn();
    },
  );
}

function wrapper(options: {
  readonly subscribeMessageRange?: SubscribeMessageRange;
  readonly seekPlayback?: (time: Time) => void;
  readonly pausePlayback?: () => void;
  readonly startPlayback?: () => void;
  readonly currentTime?: Time;
  readonly requestWindow?: number;
}): (props: PropsWithChildren) => React.JSX.Element {
  const appConfiguration = new FakeAppConfiguration([[AppSetting.REQUEST_WINDOW, options.requestWindow]]);

  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return (
      <AppConfigurationContext.Provider value={appConfiguration}>
        <MockCurrentLayoutProvider>
          <MockMessagePipelineProvider
            topics={topics}
            datatypes={datatypes}
            subscribeMessageRange={options.subscribeMessageRange}
            seekPlayback={options.seekPlayback}
            pausePlayback={options.pausePlayback}
            startPlayback={options.startPlayback}
            startTime={time(0)}
            currentTime={options.currentTime ?? time(1)}
            endTime={time(5)}
          >
            {children}
          </MockMessagePipelineProvider>
        </MockCurrentLayoutProvider>
      </AppConfigurationContext.Provider>
    );
  };
}

describe("useFrameNavigation", () => {
  beforeEach(() => {
    mockEnqueueSnackbar.mockClear();
  });

  it("seeks to the next message matching the current filter", async () => {
    const currentMessage = message(1, 1);
    const subscribeMessageRange = makeSubscribeMessageRange([message(2, 2), message(3, 1)]);
    const seekPlayback = jest.fn<void, [Time]>();
    const pausePlayback = jest.fn<void, []>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, pausePlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(3));
    });
    expect(pausePlayback).toHaveBeenCalled();
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("seeks to the previous closest message matching the current filter", async () => {
    const currentMessage = message(4, 1);
    const subscribeMessageRange = makeSubscribeMessageRange([
      message(1, 1),
      message(2, 1),
      message(3, 2),
    ]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(2));
    });
  });

  it("keeps playback position and shows a toast when no next match exists", async () => {
    const currentMessage = message(1, 1);
    const subscribeMessageRange = makeSubscribeMessageRange([message(2, 2), message(3, 2)]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith("No next", { variant: "info" });
    });
    expect(seekPlayback).not.toHaveBeenCalled();
  });

  it("cancels an in-flight range query on restore", async () => {
    const currentMessage = message(1, 1);
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => unsubscribe);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onRestore();
    });

    await waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(result.current.isFrameNavigationPending).toBe(false);
  });

  it("falls back to playback-based next frame when range subscription is unavailable", () => {
    const currentMessage = message(1, 1);
    const startPlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ startPlayback, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    expect(startPlayback).toHaveBeenCalled();
    expect(seekPlayback).not.toHaveBeenCalled();
  });
});
