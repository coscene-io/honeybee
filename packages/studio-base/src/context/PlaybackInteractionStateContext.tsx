// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";
import { createStore, StoreApi, useStore } from "zustand";

import { Immutable } from "@foxglove/studio";

export type AcquireKeyframeSearchLockArgs = {
  isPlaying?: boolean;
  pausePlayback?: (() => void) | undefined;
  startPlayback?: (() => void) | undefined;
};

export type PlaybackInteractionStateStore = Immutable<{
  keyframeSearchLockCount: number;
  acquireKeyframeSearchLock: (args?: AcquireKeyframeSearchLockArgs) => () => void;
}>;

export const PlaybackInteractionStateContext = createContext<
  undefined | StoreApi<PlaybackInteractionStateStore>
>(undefined);

const defaultPlaybackInteractionStateStore = createStore<PlaybackInteractionStateStore>(() => ({
  keyframeSearchLockCount: 0,
  acquireKeyframeSearchLock: () => () => {},
}));

export const selectIsKeyframeSearchActive = (store: PlaybackInteractionStateStore): boolean =>
  store.keyframeSearchLockCount > 0;

export function usePlaybackInteractionState<T>(
  selector: (store: PlaybackInteractionStateStore) => T,
): T {
  const context =
    useContext(PlaybackInteractionStateContext) ?? defaultPlaybackInteractionStateStore;
  return useStore(context, selector);
}
