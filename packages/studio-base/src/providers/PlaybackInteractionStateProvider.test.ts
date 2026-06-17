// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { selectIsKeyframeSearchActive } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";

import { createPlaybackInteractionStateStore } from "./PlaybackInteractionStateProvider";

describe("PlaybackInteractionStateProvider", () => {
  it("pauses playback once and resumes after the final keyframe search lock releases", () => {
    const store = createPlaybackInteractionStateStore();
    const pausePlayback = jest.fn();
    const startPlayback = jest.fn();

    const releaseFirst = store.getState().acquireKeyframeSearchLock({
      isPlaying: true,
      pausePlayback,
      startPlayback,
    });
    const releaseSecond = store.getState().acquireKeyframeSearchLock({
      isPlaying: true,
      pausePlayback,
      startPlayback,
    });

    expect(selectIsKeyframeSearchActive(store.getState())).toBe(true);
    expect(store.getState().keyframeSearchLockCount).toBe(2);
    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(startPlayback).not.toHaveBeenCalled();

    releaseFirst();

    expect(selectIsKeyframeSearchActive(store.getState())).toBe(true);
    expect(store.getState().keyframeSearchLockCount).toBe(1);
    expect(startPlayback).not.toHaveBeenCalled();

    releaseSecond();

    expect(selectIsKeyframeSearchActive(store.getState())).toBe(false);
    expect(store.getState().keyframeSearchLockCount).toBe(0);
    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(startPlayback).toHaveBeenCalledTimes(1);

    releaseSecond();

    expect(store.getState().keyframeSearchLockCount).toBe(0);
    expect(startPlayback).toHaveBeenCalledTimes(1);
  });

  it("does not pause or resume when the keyframe search starts while playback is paused", () => {
    const store = createPlaybackInteractionStateStore();
    const pausePlayback = jest.fn();
    const startPlayback = jest.fn();

    const release = store.getState().acquireKeyframeSearchLock({
      isPlaying: false,
      pausePlayback,
      startPlayback,
    });

    expect(selectIsKeyframeSearchActive(store.getState())).toBe(true);
    expect(pausePlayback).not.toHaveBeenCalled();

    release();

    expect(selectIsKeyframeSearchActive(store.getState())).toBe(false);
    expect(startPlayback).not.toHaveBeenCalled();
  });
});
