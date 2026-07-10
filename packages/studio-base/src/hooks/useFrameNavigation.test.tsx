/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook, waitFor } from "@testing-library/react";
import { PropsWithChildren } from "react";

import { compare } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import type { MessageAndData } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext, {
  AppConfigurationValue,
  IAppConfiguration,
} from "@foxglove/studio-base/context/AppConfigurationContext";
import useGlobalVariables from "@foxglove/studio-base/hooks/useGlobalVariables";
import { MessageEvent, SubscribeMessageRange, Topic } from "@foxglove/studio-base/players/types";
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

function messageAt(receiveTime: Time, value: number): MessageEvent {
  return {
    topic: "/topic",
    receiveTime,
    message: { value },
    schemaName: "datatype",
    sizeInBytes: 0,
  };
}

function message(sec: number, value: number): MessageEvent {
  return messageAt(time(sec), value);
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
  return (
    compare(messageEvent.receiveTime, start) >= 0 && compare(messageEvent.receiveTime, end) <= 0
  );
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
  readonly getSubscribeMessageRange?: () => SubscribeMessageRange | undefined;
  readonly seekPlayback?: (time: Time) => void;
  readonly pausePlayback?: () => void;
  readonly startPlayback?: () => void;
  readonly currentTime?: Time;
  readonly requestWindow?: number;
  readonly playerId?: () => string;
  readonly startTime?: () => Time;
  readonly topics?: () => Topic[];
  readonly datatypes?: () => RosDatatypes;
  readonly globalVariables?: Record<string, string | number>;
}): (props: PropsWithChildren) => React.JSX.Element {
  const appConfiguration = new FakeAppConfiguration([
    [AppSetting.REQUEST_WINDOW, options.requestWindow],
  ]);

  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return (
      <AppConfigurationContext.Provider value={appConfiguration}>
        <MockCurrentLayoutProvider
          initialState={
            options.globalVariables != undefined
              ? { globalVariables: options.globalVariables }
              : undefined
          }
        >
          <MockMessagePipelineProvider
            topics={options.topics?.() ?? topics}
            datatypes={options.datatypes?.() ?? datatypes}
            subscribeMessageRange={
              options.getSubscribeMessageRange?.() ?? options.subscribeMessageRange
            }
            seekPlayback={options.seekPlayback}
            pausePlayback={options.pausePlayback}
            startPlayback={options.startPlayback}
            startTime={options.startTime?.() ?? time(0)}
            currentTime={options.currentTime ?? time(1)}
            endTime={time(5)}
            playerId={options.playerId?.()}
          >
            {children}
          </MockMessagePipelineProvider>
        </MockCurrentLayoutProvider>
      </AppConfigurationContext.Provider>
    );
  };
}

function requiredKeyHandler(
  handlers: Record<string, ((event: KeyboardEvent) => void | boolean | undefined) | undefined>,
  key: string,
): (event: KeyboardEvent) => void | boolean | undefined {
  const handler = handlers[key];
  if (handler == undefined) {
    throw new Error(`Expected ${key} handler`);
  }
  return handler;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise == undefined) {
    throw new Error("Expected deferred resolver to be initialized");
  }
  return { promise, resolve: resolvePromise };
}

describe("useFrameNavigation", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

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

  it("uses rendered history before requesting a previous range", () => {
    const subscribeMessageRange = makeSubscribeMessageRange([message(1, 1)]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(3) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      result.current.updateRenderedTime([messageAndData(message(3, 1))]);
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenCalledWith(time(2));
    expect(subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("reuses all candidates from the previous range window", async () => {
    const current = message(5, 1);
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(current)]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime);
    });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(latest)]);
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenLastCalledWith(earlier.receiveTime);
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([]);
    });
    expect(result.current.getEffectiveMessages([])).toEqual([messageAndData(earlier)]);
  });

  it("continues before the cached covered range when its candidates are exhausted", async () => {
    const older = messageAt(time(4, 400_000_000), 1);
    const cachedEarlier = messageAt(time(4, 600_000_000), 1);
    const cachedLatest = messageAt(time(4, 800_000_000), 1);
    const requestedRanges: { readonly start: Time; readonly end: Time }[] = [];
    const rangeMessages = [older, cachedEarlier, cachedLatest];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ timeRange, onNewRangeIterator }) => {
      requestedRanges.push(timeRange);
      const batch = rangeMessages.filter((event) =>
        inRange(event, timeRange.start, timeRange.end),
      );
      void onNewRangeIterator(
        (async function* () {
          yield batch;
        })(),
      );
      return jest.fn();
    });
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () => useFrameNavigation({ path }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(cachedLatest.receiveTime); });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(cachedLatest)]);
      result.current.handlePreviousFrame();
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(cachedEarlier)]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(older.receiveTime); });
    expect(requestedRanges[1]?.end).toEqual(time(4, 499_999_998));
  });

  it("keeps previous navigation enabled after rendered history is exhausted in range mode", async () => {
    const rangeFrame = messageAt(time(0, 500_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([rangeFrame]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () => useFrameNavigation({ path }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(2) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenLastCalledWith(time(1));
    expect(result.current.hasPreFrame).toBe(true);

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(rangeFrame.receiveTime); });
    expect(subscribeMessageRange).toHaveBeenCalled();
  });

  it("clears the previous range cache after a manual seek", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }),
    });

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(latest)]);
      result.current.onRestore();
      result.current.handlePreviousFrame();
    });

    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(earlier.receiveTime); });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
  });

  it("clears the previous range cache when next navigation starts", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const next = messageAt(time(4, 900_000_000), 1);
    let requestCount = 0;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      const batch = requestCount++ === 0 ? [earlier, latest] : requestCount === 2 ? [next] : [latest];
      void onNewRangeIterator(
        (async function* () {
          yield batch;
        })(),
      );
      return jest.fn();
    });
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }),
    });

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });

    act(() => {
      result.current.onRestore();
      result.current.handleNextFrame([messageAndData(latest)]);
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(next.receiveTime); });

    act(() => {
      result.current.onRestore();
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(3);
  });

  it("does not clear cache when another hook owns the frame navigation", async () => {
    jest.useFakeTimers();
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(
      () => ({ first: useFrameNavigation({ path }), second: useFrameNavigation({ path }) }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }) },
    );

    act(() => {
      result.current.second.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.second.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    act(() => {
      result.current.second.onRestore();
      result.current.second.updateRenderedTime([messageAndData(latest)]);
      jest.runOnlyPendingTimers();
      result.current.first.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.first.updateRenderedTime([messageAndData(message(2, 1))]);
      result.current.first.handlePreviousFrame();
      result.current.second.onRestore();
      result.current.first.onRestore();
      jest.runOnlyPendingTimers();
      result.current.second.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenLastCalledWith(earlier.receiveTime);
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("clears the previous range cache when the path changes", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    const { result, rerender } = renderHook(
      ({ hookPath }: { readonly hookPath: string }) => useFrameNavigation({ path: hookPath }),
      {
        initialProps: { hookPath: path },
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(5) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(latest)]);
    });

    rerender({ hookPath: "/topic" });
    act(() => { result.current.handlePreviousFrame(); });

    await waitFor(() => { expect(subscribeMessageRange).toHaveBeenCalledTimes(2); });
  });

  it("clears the previous range cache when the data start time changes", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    let startTime = time(0);
    const { result, rerender } = renderHook(
      ({ renderId }: { readonly renderId: number }) => {
        void renderId;
        return useFrameNavigation({ path });
      },
      {
        initialProps: { renderId: 1 },
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          currentTime: time(5),
          startTime: () => startTime,
        }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(latest)]);
    });
    seekPlayback.mockClear();

    startTime = time(4, 700_000_000);
    rerender({ renderId: 2 });
    act(() => { result.current.handlePreviousFrame(); });

    await waitFor(() => { expect(subscribeMessageRange).toHaveBeenCalledTimes(2); });
    expect(seekPlayback).not.toHaveBeenCalledWith(earlier.receiveTime);
  });

  it("clears the previous range cache when the player changes", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    let playerId = "player-1";
    const { result, rerender } = renderHook(
      ({ renderId }: { readonly renderId: number }) => {
        void renderId;
        return useFrameNavigation({ path });
      },
      {
        initialProps: { renderId: 1 },
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          currentTime: time(5),
          playerId: () => playerId,
        }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    act(() => { result.current.onRestore(); });

    playerId = "player-2";
    rerender({ renderId: 2 });
    act(() => { result.current.handlePreviousFrame(); });

    await waitFor(() => { expect(subscribeMessageRange).toHaveBeenCalledTimes(2); });
  });

  it("clears the previous range cache when the range provider changes", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const firstProvider = makeSubscribeMessageRange([earlier, latest]);
    const secondProvider = makeSubscribeMessageRange([earlier, latest]);
    let activeProvider = firstProvider;
    const seekPlayback = jest.fn<void, [Time]>();
    const { result, rerender } = renderHook(
      ({ renderId }: { readonly renderId: number }) => {
        void renderId;
        return useFrameNavigation({ path });
      },
      {
        initialProps: { renderId: 1 },
        wrapper: wrapper({
          getSubscribeMessageRange: () => activeProvider,
          seekPlayback,
          currentTime: time(5),
        }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(firstProvider).toHaveBeenCalledTimes(1); });
    act(() => { result.current.onRestore(); });

    activeProvider = secondProvider;
    rerender({ renderId: 2 });
    act(() => { result.current.handlePreviousFrame(); });

    await waitFor(() => { expect(secondProvider).toHaveBeenCalledTimes(1); });
  });

  it("clears cached coverage when a path global variable changes", async () => {
    const variablePath = "/topic{value==$target}.value";
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const requestedRanges: { readonly start: Time; readonly end: Time }[] = [];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ timeRange, onNewRangeIterator }) => {
      requestedRanges.push(timeRange);
      const batch = [earlier, latest].filter((event) =>
        inRange(event, timeRange.start, timeRange.end),
      );
      void onNewRangeIterator(
        (async function* () {
          yield batch;
        })(),
      );
      return jest.fn();
    });
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(
      () => {
        const frameNavigation = useFrameNavigation({ path: variablePath });
        const { setGlobalVariables } = useGlobalVariables();
        return { frameNavigation, setGlobalVariables };
      },
      {
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          currentTime: time(5),
          globalVariables: { target: 1 },
        }),
      },
    );

    act(() => {
      result.current.frameNavigation.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.frameNavigation.handlePreviousFrame();
    });
    await waitFor(() => { expect(seekPlayback).toHaveBeenLastCalledWith(latest.receiveTime); });
    act(() => {
      result.current.frameNavigation.onRestore();
      result.current.setGlobalVariables({ target: 2 });
    });
    act(() => { result.current.frameNavigation.handlePreviousFrame(); });

    await waitFor(() => { expect(requestedRanges.length).toBeGreaterThan(1); });
    expect(requestedRanges[1]?.end).toEqual(time(4, 799_999_999));
  });

  it("clears the previous range cache when the relevant datatype changes", async () => {
    const earlier = messageAt(time(4, 600_000_000), 1);
    const latest = messageAt(time(4, 800_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([earlier, latest]);
    const seekPlayback = jest.fn<void, [Time]>();
    let activeDatatypes = datatypes;
    const { result, rerender } = renderHook(
      ({ renderId }: { readonly renderId: number }) => {
        void renderId;
        return useFrameNavigation({ path });
      },
      {
        initialProps: { renderId: 1 },
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          currentTime: time(5),
          datatypes: () => activeDatatypes,
        }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(5, 1))]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => { expect(subscribeMessageRange).toHaveBeenCalledTimes(1); });
    act(() => { result.current.onRestore(); });

    activeDatatypes = new Map(
      Object.entries({
        datatype: {
          definitions: [{ name: "value", type: "uint64", isArray: false, isComplex: false }],
        },
      }),
    );
    rerender({ renderId: 2 });
    act(() => { result.current.handlePreviousFrame(); });

    await waitFor(() => { expect(subscribeMessageRange).toHaveBeenCalledTimes(2); });
  });

  it("keeps the found range frame visible when the seek snapshot has no matching messages", async () => {
    const currentFrame = messageAndData(message(4, 1));
    const previousFrame = messageAndData(message(2, 1));
    const subscribeMessageRange = makeSubscribeMessageRange([message(2, 1)]);
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
      result.current.updateRenderedTime([currentFrame]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(2));
    });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([]);
    });

    expect(result.current.getEffectiveMessages([])).toEqual([previousFrame]);
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

  it("cancels an in-flight range query when path variables change", async () => {
    const variablePath = "/topic{value==$target}.value";
    const currentMessage = message(1, 1);
    const releaseRange = deferred();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          await releaseRange.promise;
          yield [message(2, 1)];
        })(),
      );
      return unsubscribe;
    });
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () => {
        const frameNavigation = useFrameNavigation({
          path: variablePath,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        });
        const { setGlobalVariables } = useGlobalVariables();
        return { frameNavigation, setGlobalVariables };
      },
      {
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          globalVariables: { target: 1 },
        }),
      },
    );

    act(() => {
      result.current.frameNavigation.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.frameNavigation.handleNextFrame([messageAndData(currentMessage)]);
    });

    expect(result.current.frameNavigation.isFrameNavigationPending).toBe(true);

    act(() => {
      result.current.setGlobalVariables({ target: 2 });
    });

    await waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    expect(result.current.frameNavigation.isFrameNavigationPending).toBe(false);

    await act(async () => {
      releaseRange.resolve();
      await Promise.resolve();
    });

    expect(seekPlayback).not.toHaveBeenCalled();
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

  it("does not report previous frame when no path is selected", () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path: "",
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, currentTime: time(2) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([]);
    });

    expect(result.current.hasPreFrame).toBe(false);
  });

  it("uses rendered history without probing an unsupported range subscription", async () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => undefined);
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
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(1));
    });
    expect(subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("clears previous frame availability when unsupported range has no rendered history", async () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => undefined);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(2) }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([]);
    });

    expect(result.current.hasPreFrame).toBe(true);

    act(() => {
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(result.current.hasPreFrame).toBe(false);
    });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("falls back to playback-based next frame when range subscription returns unsupported", async () => {
    const currentMessage = message(1, 1);
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => undefined);
    const startPlayback = jest.fn<void, []>();
    const pausePlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, startPlayback, pausePlayback, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    await waitFor(() => {
      expect(startPlayback).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.updateRenderedTime([
        messageAndData(message(2, 1)),
        messageAndData(message(3, 1)),
      ]);
    });

    expect(seekPlayback).toHaveBeenCalledWith(time(2));
  });

  it("ignores the current frame when unsupported range navigation falls back to next frame", async () => {
    const currentMessage = message(1, 1);
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => undefined);
    const startPlayback = jest.fn<void, []>();
    const pausePlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, startPlayback, pausePlayback, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    await waitFor(() => {
      expect(startPlayback).toHaveBeenCalledTimes(1);
    });
    pausePlayback.mockClear();
    seekPlayback.mockClear();

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
    });

    expect(pausePlayback).not.toHaveBeenCalled();
    expect(seekPlayback).not.toHaveBeenCalled();

    act(() => {
      result.current.updateRenderedTime([
        messageAndData(currentMessage),
        messageAndData(message(2, 1)),
      ]);
    });

    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenCalledWith(time(2));
  });

  it("does not duplicate rendered history when active time changes without new messages", async () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => undefined);
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
      result.current.updateRenderedTime([
        messageAndData(message(2, 1)),
        messageAndData(message(3, 1)),
      ]);
      result.current.updateRenderedTime([
        messageAndData(message(2, 1)),
        messageAndData(message(3, 1)),
      ]);
      result.current.updateRenderedTime([
        messageAndData(message(2, 1)),
        messageAndData(message(3, 1)),
      ]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(2));
    });

    act(() => {
      result.current.onRestore();
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    });
    expect(seekPlayback).toHaveBeenCalledTimes(1);
  });

  it("does not re-append carried-over fallback history", () => {
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([
        messageAndData(message(1, 1)),
        messageAndData(message(2, 1)),
      ]);
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenCalledWith(time(1));

    act(() => {
      result.current.onRestore();
    });
    seekPlayback.mockClear();

    act(() => {
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).not.toHaveBeenCalled();
  });

  it("retries range navigation after an unsupported path changes", async () => {
    const unsupportedPath = path;
    const supportedPath = "/topic{value==2}.value";
    let rangeSupported = false;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      if (!rangeSupported) {
        return undefined;
      }
      void onNewRangeIterator(
        (async function* () {
          yield [message(3, 2)];
        })(),
      );
      return jest.fn();
    });
    const startPlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();

    const { result, rerender } = renderHook(
      ({ hookPath }: { readonly hookPath: string }) =>
        useFrameNavigation({
          path: hookPath,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        initialProps: { hookPath: unsupportedPath },
        wrapper: wrapper({ subscribeMessageRange, startPlayback, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.handleNextFrame([messageAndData(message(1, 1))]);
    });

    await waitFor(() => { expect(startPlayback).toHaveBeenCalled(); });

    act(() => {
      result.current.onRestore();
    });
    seekPlayback.mockClear();

    rangeSupported = true;
    rerender({ hookPath: supportedPath });

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 2))]);
      result.current.handleNextFrame([messageAndData(message(1, 2))]);
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(3));
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
  });

  it("retries range navigation after the player changes", async () => {
    let playerId = "1";
    let rangeSupported = false;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      if (!rangeSupported) {
        return undefined;
      }
      void onNewRangeIterator(
        (async function* () {
          yield [message(3, 1)];
        })(),
      );
      return jest.fn();
    });
    const startPlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();

    const { result, rerender } = renderHook(
      ({ renderId }: { readonly renderId: number }) => {
        void renderId;
        return useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        });
      },
      {
        initialProps: { renderId: 1 },
        wrapper: wrapper({
          subscribeMessageRange,
          startPlayback,
          seekPlayback,
          playerId: () => playerId,
        }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.handleNextFrame([messageAndData(message(1, 1))]);
    });

    await waitFor(() => { expect(startPlayback).toHaveBeenCalled(); });

    act(() => {
      result.current.onRestore();
    });
    seekPlayback.mockClear();

    rangeSupported = true;
    playerId = "2";
    rerender({ renderId: 2 });

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.handleNextFrame([messageAndData(message(1, 1))]);
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(3));
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
  });

  it("falls back to rendered history for previous frame when range subscription is unavailable", () => {
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
        wrapper: wrapper({ seekPlayback, pausePlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
    });

    expect(result.current.hasPreFrame).toBe(true);

    act(() => {
      result.current.handlePreviousFrame();
    });

    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenCalledWith(time(1));
    expect(result.current.hasPreFrame).toBe(false);
  });

  it("keeps the fallback previous frame visible when the seek snapshot has no matching messages", () => {
    const firstFrame = messageAndData(message(1, 1));
    const secondFrame = messageAndData(message(2, 1));
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([firstFrame]);
      result.current.updateRenderedTime([secondFrame]);
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).toHaveBeenCalledWith(time(1));

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([]);
    });

    expect(result.current.getEffectiveMessages([])).toEqual([firstFrame]);
  });

  it("cancels pending range navigation and resets state when path changes", async () => {
    const currentMessage = message(1, 1);
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => unsubscribe);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result, rerender } = renderHook(
      ({ hookPath }: { readonly hookPath: string }) =>
        useFrameNavigation({
          path: hookPath,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        initialProps: { hookPath: path },
        wrapper: wrapper({ subscribeMessageRange, seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(currentMessage)]);
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });

    expect(result.current.isFrameNavigationPending).toBe(true);

    rerender({ hookPath: "/topic{value==2}.value" });

    await waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(seekPlayback).not.toHaveBeenCalled();
  });

  it("ends pending range navigation when unmounted", async () => {
    jest.useFakeTimers();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => unsubscribe);

    const firstHook = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback: jest.fn<void, [Time]>() }),
      },
    );

    act(() => {
      firstHook.result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      firstHook.result.current.handleNextFrame([messageAndData(message(1, 1))]);
    });

    firstHook.unmount();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ seekPlayback }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      result.current.onRestore();
      result.current.handlePreviousFrame();
    });

    expect(seekPlayback).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  it("handles keyboard frame navigation and clears repeat timers", () => {
    jest.useFakeTimers();
    const startPlayback = jest.fn<void, []>();
    const seekPlayback = jest.fn<void, [Time]>();
    const pausePlayback = jest.fn<void, []>();
    const panelElement = document.createElement("div");
    const focusedElement = document.createElement("button");
    panelElement.appendChild(focusedElement);
    document.body.appendChild(panelElement);

    const { result, unmount } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({ startPlayback, seekPlayback, pausePlayback }),
      },
    );

    Object.defineProperty(result.current.panelRef, "current", {
      configurable: true,
      value: panelElement,
    });
    focusedElement.focus();

    act(() => {
      result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      requiredKeyHandler(
        result.current.keyDownHandlers,
        "ArrowUp",
      )(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });

    expect(seekPlayback).toHaveBeenCalledWith(time(1));
    expect(jest.getTimerCount()).toBe(1);

    act(() => {
      requiredKeyHandler(
        result.current.keyUpHandlers,
        "ArrowUp",
      )(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    });

    expect(jest.getTimerCount()).toBe(0);

    act(() => {
      result.current.onRestore();
      jest.runOnlyPendingTimers();
      requiredKeyHandler(
        result.current.keyDownHandlers,
        "ArrowDown",
      )(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
    panelElement.remove();
  });
});
