/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec } from "@foxglove/rostime";
import { Immutable, MessageEvent, RenderState } from "@foxglove/studio";

import type { IRenderer } from "./IRenderer";
import {
  completeRenderTick,
  configureRendererPlaybackHooks,
  currentFrameForRenderTick,
  mergeRenderStatesForRenderer,
  renderStateForNewRenderer,
  snapshotRenderState,
} from "./ThreeDeeRender";

jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

function deferredPromise(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function message(topic: string, time: bigint): MessageEvent {
  return {
    topic,
    receiveTime: fromNanoSec(time),
    schemaName: "example.Message",
    message: {},
    sizeInBytes: 0,
  };
}

function renderState({
  time,
  currentFrame,
  allFrames,
  didSeek = false,
}: {
  time: bigint;
  currentFrame?: readonly MessageEvent[];
  allFrames?: readonly MessageEvent[];
  didSeek?: boolean;
}): Immutable<RenderState> {
  return {
    currentTime: fromNanoSec(time),
    currentFrame,
    allFrames,
    didSeek,
  };
}

describe("mergeRenderStatesForRenderer", () => {
  it("preserves the first paused/static batch until a renderer can consume it", () => {
    const firstMessage = message("/first", 1n);
    const staticMessage = message("/static", 1n);
    const first = renderState({
      time: 1n,
      currentFrame: [firstMessage],
      allFrames: [staticMessage],
    });
    const latest = renderState({ time: 2n, currentFrame: [message("/latest", 2n)] });

    const merged = mergeRenderStatesForRenderer(first, latest);

    expect(merged.currentTime).toEqual(fromNanoSec(2n));
    expect(merged.currentFrame).toEqual([firstMessage, latest.currentFrame![0]]);
    expect(merged.allFrames).toBe(first.allFrames);
  });

  it("drops buffered pre-seek messages when the pending state seeks", () => {
    const beforeSeek = renderState({
      time: 1n,
      currentFrame: [message("/before", 1n)],
      allFrames: [message("/static-before", 1n)],
    });
    const afterSeek = renderState({
      time: 10n,
      currentFrame: [message("/after", 10n)],
      allFrames: [message("/static-after", 10n)],
      didSeek: true,
    });

    expect(mergeRenderStatesForRenderer(beforeSeek, afterSeek)).toBe(afterSeek);
  });

  it("detaches the reusable top-level state without copying persistent frame arrays", () => {
    const firstMessage = message("/first", 1n);
    const firstCurrentFrame = [firstMessage];
    const allFrames = [message("/static", 1n)];
    const reusedRenderState = renderState({
      time: 1n,
      currentFrame: firstCurrentFrame,
      allFrames,
    }) as RenderState;
    const firstSnapshot = snapshotRenderState(reusedRenderState);

    const latestMessage = message("/latest", 3n);
    reusedRenderState.currentTime = fromNanoSec(3n);
    reusedRenderState.currentFrame = [latestMessage];
    const latestSnapshot = snapshotRenderState(reusedRenderState);

    const merged = mergeRenderStatesForRenderer(firstSnapshot, latestSnapshot);
    expect(firstSnapshot.currentFrame).toBe(firstCurrentFrame);
    expect(firstSnapshot.allFrames).toBe(allFrames);
    expect(merged.currentFrame).toEqual([firstMessage, latestMessage]);
  });

  it("consumes a retained currentFrame identity only once across metadata and EOF renders", () => {
    const currentFrame = [message("/video", 1n)];
    const initialIdentity = Symbol("initial");

    expect(currentFrameForRenderTick(currentFrame, initialIdentity)).toBe(currentFrame);
    expect(currentFrameForRenderTick(currentFrame, currentFrame)).toBeUndefined();
    expect(currentFrameForRenderTick([], currentFrame)).toEqual([]);
  });
});

describe("renderStateForNewRenderer", () => {
  it("treats a delta-only latest tick as a cold seek replay", () => {
    const latest = renderState({
      time: 10n,
      currentFrame: [message("/video", 10n)],
      didSeek: false,
    });

    const replay = renderStateForNewRenderer(latest);

    expect(replay).not.toBe(latest);
    expect(replay).toMatchObject({
      currentTime: fromNanoSec(10n),
      currentFrame: latest.currentFrame,
      didSeek: true,
    });
  });

  it("preserves an existing seek render state", () => {
    const seek = renderState({ time: 10n, didSeek: true });
    expect(renderStateForNewRenderer(seek)).toBe(seek);
  });
});

describe("configureRendererPlaybackHooks", () => {
  it("attaches range lookup and playback pause hooks before a cold replay", () => {
    const renderer = {} as IRenderer;
    const subscribeMessageRange = jest.fn() as IRenderer["subscribeMessageRange"];
    const acquireSeekKeyframeSearchPlaybackPause =
      jest.fn() as IRenderer["acquireSeekKeyframeSearchPlaybackPause"];

    configureRendererPlaybackHooks(
      renderer,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    );

    expect(renderer.subscribeMessageRange).toBe(subscribeMessageRange);
    expect(renderer.acquireSeekKeyframeSearchPlaybackPause).toBe(
      acquireSeekKeyframeSearchPlaybackPause,
    );
  });
});

describe("completeRenderTick", () => {
  it("waits for renderer work, then draws before releasing the Player tick", async () => {
    const work = deferredPromise();
    const calls: string[] = [];
    const result = completeRenderTick({
      work: work.promise,
      isCurrent: () => true,
      animationFrame: () => calls.push("animationFrame"),
      done: () => calls.push("done"),
    });

    await Promise.resolve();
    expect(calls).toEqual([]);

    work.resolve();
    await result;
    expect(calls).toEqual(["animationFrame", "done"]);
  });

  it("still draws and releases the Player tick when renderer work rejects", async () => {
    const work = deferredPromise();
    const calls: string[] = [];
    const result = completeRenderTick({
      work: work.promise,
      isCurrent: () => true,
      animationFrame: () => calls.push("animationFrame"),
      done: () => calls.push("done"),
    });

    work.reject(new Error("decode failed"));
    await expect(result).rejects.toThrow("decode failed");
    expect(calls).toEqual(["animationFrame", "done"]);
  });

  it("does not draw or finish from a superseded renderer tick", async () => {
    const animationFrame = jest.fn();
    const done = jest.fn();

    await completeRenderTick({
      work: Promise.resolve(),
      isCurrent: () => false,
      animationFrame,
      done,
    });

    expect(animationFrame).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("releases the Player tick when drawing throws", async () => {
    const done = jest.fn();

    await expect(
      completeRenderTick({
        work: Promise.resolve(),
        isCurrent: () => true,
        animationFrame: () => {
          throw new Error("draw failed");
        },
        done,
      }),
    ).rejects.toThrow("draw failed");
    expect(done).toHaveBeenCalledTimes(1);
  });
});
