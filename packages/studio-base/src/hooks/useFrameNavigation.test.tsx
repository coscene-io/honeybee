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
  readonly seekPlayback?: (time: Time) => void;
  readonly pausePlayback?: () => void;
  readonly startPlayback?: () => void;
  readonly currentTime?: Time | (() => Time);
  readonly isPlaying?: boolean;
  readonly requestWindow?: number;
  readonly playerId?: () => string;
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
            topics={topics}
            datatypes={datatypes}
            subscribeMessageRange={options.subscribeMessageRange}
            seekPlayback={options.seekPlayback}
            pausePlayback={options.pausePlayback}
            startPlayback={options.startPlayback}
            startTime={time(0)}
            currentTime={
              typeof options.currentTime === "function"
                ? options.currentTime()
                : (options.currentTime ?? time(1))
            }
            isPlaying={options.isPlaying}
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

  it("does not treat the current playback time as a previous frame", async () => {
    const currentTime = time(1, 500);
    const displayedMessage = messageAt(time(1, 1_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([messageAt(currentTime, 1)]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
        }),
      {
        wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime }),
      },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(displayedMessage)]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(result.current.frameNavigationStatusMessage).toBe("No previous");
    });
    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(result.current.hasPreFrame).toBe(false);
    expect(seekPlayback).not.toHaveBeenCalled();

    const requestCount = subscribeMessageRange.mock.calls.length;
    act(() => {
      result.current.handlePreviousFrame();
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(requestCount);
  });

  it("finishes next navigation when the matching frame is already current", async () => {
    const currentTime = time(2);
    const displayedMessage = message(1, 1);
    const currentMessage = messageAt(currentTime, 1);
    const nextMessage = message(3, 1);
    const subscribeMessageRange = makeSubscribeMessageRange([currentMessage, nextMessage]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime }),
    });

    act(() => {
      result.current.updateRenderedTime([messageAndData(displayedMessage)]);
      result.current.handleNextFrame([messageAndData(displayedMessage)]);
    });

    await waitFor(() => {
      expect(result.current.isFrameNavigationPending).toBe(false);
    });
    expect(result.current.getEffectiveMessages([messageAndData(displayedMessage)])).toEqual([
      messageAndData(currentMessage),
    ]);

    act(() => {
      result.current.handleNextFrame([messageAndData(displayedMessage)]);
    });
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(nextMessage.receiveTime);
    });
  });

  it("searches from the playback cursor after a manual seek leaves stale messages", async () => {
    const staleMessage = message(1, 1);
    const rangeMessages = [message(2, 1)];
    const subscribeMessageRange = makeSubscribeMessageRange(rangeMessages);
    const seekPlayback = jest.fn<void, [Time]>();
    let currentTime = time(3);

    const { result, rerender } = renderHook(
      () => useFrameNavigation({ path, noNextFrameMessage: "No next" }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: () => currentTime }) },
    );

    act(() => {
      result.current.updateRenderedTime([messageAndData(staleMessage)]);
      result.current.onRestore();
      result.current.handleNextFrame([messageAndData(staleMessage)]);
    });

    await waitFor(() => {
      expect(result.current.frameNavigationStatusMessage).toBe("No next");
    });
    expect(seekPlayback).not.toHaveBeenCalled();

    act(() => {
      result.current.handleNextFrame([messageAndData(staleMessage)]);
    });
    await waitFor(() => {
      expect(result.current.frameNavigationStatusMessage).toBe("No next");
    });
    expect(seekPlayback).not.toHaveBeenCalled();

    currentTime = time(4);
    rangeMessages.push(messageAt(time(3, 500_000_000), 1));
    rerender();
    act(() => {
      const latestMessage = message(4, 1);
      result.current.updateRenderedTime([messageAndData(latestMessage)]);
      result.current.handleNextFrame([messageAndData(latestMessage)]);
    });
    await waitFor(() => {
      expect(result.current.frameNavigationStatusMessage).toBe("No next");
    });
    expect(seekPlayback).not.toHaveBeenCalled();
  });

  it("releases a held frame after playback advances past it", async () => {
    const heldMessage = message(2, 1);
    const displayedMessage = message(1, 1);
    const subscribeMessageRange = makeSubscribeMessageRange([heldMessage]);
    let currentTime = time(2);
    const { result, rerender } = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({
        subscribeMessageRange,
        seekPlayback: jest.fn<void, [Time]>(),
        currentTime: () => currentTime,
      }),
    });

    act(() => {
      result.current.updateRenderedTime([messageAndData(displayedMessage)]);
      result.current.handleNextFrame([messageAndData(displayedMessage)]);
    });
    await waitFor(() => {
      expect(result.current.isFrameNavigationPending).toBe(false);
    });
    expect(result.current.getEffectiveMessages([messageAndData(displayedMessage)])).toEqual([
      messageAndData(heldMessage),
    ]);

    currentTime = time(3);
    rerender();
    const playbackMessage = message(3, 1);
    act(() => {
      result.current.updateRenderedTime([messageAndData(playbackMessage)]);
    });

    expect(result.current.getEffectiveMessages([messageAndData(playbackMessage)])).toEqual([
      messageAndData(playbackMessage),
    ]);
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

  it("continues previous navigation from the last matching frame", async () => {
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
      const batch = rangeMessages.filter((event) => inRange(event, timeRange.start, timeRange.end));
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
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenLastCalledWith(cachedLatest.receiveTime);
    });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(cachedLatest)]);
      result.current.handlePreviousFrame();
    });
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenLastCalledWith(cachedEarlier.receiveTime);
    });

    act(() => {
      result.current.onRestore();
      result.current.updateRenderedTime([messageAndData(cachedEarlier)]);
      result.current.handlePreviousFrame();
    });

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenLastCalledWith(older.receiveTime);
    });
    expect(requestedRanges[1]?.end).toEqual(time(4, 799_999_999));
    expect(requestedRanges).toHaveLength(3);
  });

  it("keeps previous navigation enabled after rendered history is exhausted in range mode", async () => {
    const rangeFrame = messageAt(time(0, 500_000_000), 1);
    const subscribeMessageRange = makeSubscribeMessageRange([rangeFrame]);
    const seekPlayback = jest.fn<void, [Time]>();

    const { result } = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({ subscribeMessageRange, seekPlayback, currentTime: time(2) }),
    });

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

    await waitFor(() => {
      expect(seekPlayback).toHaveBeenLastCalledWith(rangeFrame.receiveTime);
    });
    expect(subscribeMessageRange).toHaveBeenCalled();
  });

  it("lets the most recently started range navigation win across panels", async () => {
    const firstRelease = deferred();
    const secondRelease = deferred();
    let requestIndex = 0;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      const index = requestIndex++;
      const release = index === 0 ? firstRelease : secondRelease;
      const nextMessage = index === 0 ? message(2, 1) : message(3, 1);
      void onNewRangeIterator(
        (async function* () {
          await release.promise;
          yield [nextMessage];
        })(),
      );
      return jest.fn();
    });
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(
      () => ({ first: useFrameNavigation({ path }), second: useFrameNavigation({ path }) }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback }) },
    );

    act(() => {
      const currentMessage = messageAndData(message(1, 1));
      result.current.first.updateRenderedTime([currentMessage]);
      result.current.second.updateRenderedTime([currentMessage]);
      result.current.first.handleNextFrame([currentMessage]);
      result.current.second.handleNextFrame([currentMessage]);
    });

    expect(result.current.first.isFrameNavigationPending).toBe(false);
    expect(result.current.second.isFrameNavigationPending).toBe(true);

    await act(async () => {
      firstRelease.resolve();
      await Promise.resolve();
    });
    expect(seekPlayback).not.toHaveBeenCalled();

    await act(async () => {
      secondRelease.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledTimes(1);
    });
    expect(seekPlayback).toHaveBeenCalledWith(time(3));
  });

  it("clears a completed seek when another panel supersedes it before restore", async () => {
    const secondRelease = deferred();
    let requestIndex = 0;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      const index = requestIndex++;
      void onNewRangeIterator(
        (async function* () {
          if (index === 1) {
            await secondRelease.promise;
          }
          yield [message(index === 0 ? 2 : 3, 1)];
        })(),
      );
      return jest.fn();
    });
    const seekPlayback = jest.fn<void, [Time]>();
    const { result } = renderHook(
      () => ({ first: useFrameNavigation({ path }), second: useFrameNavigation({ path }) }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback }) },
    );
    const currentMessage = messageAndData(message(1, 1));

    act(() => {
      result.current.first.updateRenderedTime([currentMessage]);
      result.current.second.updateRenderedTime([currentMessage]);
      result.current.first.handleNextFrame([currentMessage]);
    });
    await waitFor(() => {
      expect(seekPlayback).toHaveBeenCalledWith(time(2));
    });

    act(() => {
      result.current.second.handleNextFrame([currentMessage]);
    });

    expect(result.current.first.isFrameNavigationPending).toBe(false);
    expect(result.current.first.getEffectiveMessages([currentMessage])).toEqual([currentMessage]);
    await act(async () => {
      secondRelease.resolve();
      await Promise.resolve();
    });
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

  it("keeps playback position and exposes panel feedback when no next match exists", async () => {
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
      expect(result.current.frameNavigationStatusMessage).toBe("No next");
    });
    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
    expect(seekPlayback).not.toHaveBeenCalled();

    const requestCount = subscribeMessageRange.mock.calls.length;
    act(() => {
      result.current.handleNextFrame([messageAndData(currentMessage)]);
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(requestCount);

    act(() => {
      result.current.onRestore();
    });
    expect(result.current.frameNavigationStatusMessage).toBeUndefined();
  });

  it("exposes cancellable inline feedback for a slow range navigation", async () => {
    jest.useFakeTimers();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => unsubscribe);
    const seekPlayback = jest.fn<void, [Time]>();
    const currentMessage = messageAndData(message(1, 1));
    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          searchingNextFrameMessage: "Searching next",
        }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback }) },
    );

    act(() => {
      result.current.updateRenderedTime([currentMessage]);
      result.current.handleNextFrame([currentMessage]);
    });

    expect(result.current.isFrameNavigationPending).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1_999);
    });
    expect(result.current.frameNavigationStatusMessage).toBeUndefined();
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.frameNavigationStatusMessage).toBe("Searching next");
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();

    act(() => {
      result.current.cancelFrameNavigation();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(result.current.frameNavigationStatusMessage).toBeUndefined();
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(result.current.getEffectiveMessages([currentMessage])).toEqual([currentMessage]);
  });

  it("replaces inline search feedback with the no-match result", async () => {
    jest.useFakeTimers();
    const releaseRange = deferred();
    const iteratorDone = deferred();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          await releaseRange.promise;
          yield [];
        })(),
      ).then(iteratorDone.resolve);
      return jest.fn();
    });
    const currentMessage = messageAndData(message(1, 1));
    const { result } = renderHook(
      () => useFrameNavigation({ path, noNextFrameMessage: "No next" }),
      { wrapper: wrapper({ subscribeMessageRange, seekPlayback: jest.fn<void, [Time]>() }) },
    );

    act(() => {
      result.current.updateRenderedTime([currentMessage]);
      result.current.handleNextFrame([currentMessage]);
      jest.advanceTimersByTime(2_000);
    });
    expect(result.current.frameNavigationStatusMessage).toBe("Searching for next matching frame…");
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();

    await act(async () => {
      releaseRange.resolve();
      await iteratorDone.promise;
      await Promise.resolve();
    });

    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(result.current.frameNavigationStatusMessage).toBe("No next");
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("cancels an in-flight range query on restore", async () => {
    jest.useFakeTimers();
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
      jest.advanceTimersByTime(2_000);
    });

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(result.current.frameNavigationStatusMessage).toBe("Searching for next matching frame…");
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();

    act(() => {
      result.current.onRestore();
    });

    await waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(result.current.isFrameNavigationPending).toBe(false);
    expect(result.current.frameNavigationStatusMessage).toBeUndefined();
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
    const pausePlayback = jest.fn<void, []>();
    const startPlayback = jest.fn<void, []>();

    const { result } = renderHook(
      () =>
        useFrameNavigation({
          path,
          noPreviousFrameMessage: "No previous",
          noNextFrameMessage: "No next",
        }),
      {
        wrapper: wrapper({
          subscribeMessageRange,
          seekPlayback,
          pausePlayback,
          startPlayback,
          currentTime: time(2),
          isPlaying: true,
        }),
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
    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(startPlayback).toHaveBeenCalledTimes(1);
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

    await waitFor(() => {
      expect(startPlayback).toHaveBeenCalled();
    });

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

    await waitFor(() => {
      expect(startPlayback).toHaveBeenCalled();
    });

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

  it("ends completed range navigation when unmounted before restore", async () => {
    jest.useFakeTimers();
    const firstSeekPlayback = jest.fn<void, [Time]>();
    const firstHook = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({
        subscribeMessageRange: makeSubscribeMessageRange([message(2, 1)]),
        seekPlayback: firstSeekPlayback,
      }),
    });

    act(() => {
      const currentMessage = messageAndData(message(1, 1));
      firstHook.result.current.updateRenderedTime([currentMessage]);
      firstHook.result.current.handleNextFrame([currentMessage]);
    });
    await waitFor(() => {
      expect(firstSeekPlayback).toHaveBeenCalledWith(time(2));
    });

    firstHook.unmount();
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const secondSeekPlayback = jest.fn<void, [Time]>();
    const secondHook = renderHook(() => useFrameNavigation({ path }), {
      wrapper: wrapper({ seekPlayback: secondSeekPlayback }),
    });
    act(() => {
      secondHook.result.current.updateRenderedTime([messageAndData(message(1, 1))]);
      secondHook.result.current.updateRenderedTime([messageAndData(message(2, 1))]);
      secondHook.result.current.onRestore();
      secondHook.result.current.handlePreviousFrame();
    });

    expect(secondSeekPlayback).not.toHaveBeenCalled();
    secondHook.unmount();
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

    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    panelElement.remove();
  });
});
