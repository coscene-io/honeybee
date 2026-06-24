// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";
import { createStore, StoreApi } from "zustand";

import {
  AcquireKeyframeSearchLockArgs,
  PlaybackInteractionStateContext,
  PlaybackInteractionStateStore,
} from "@foxglove/studio-base/context/PlaybackInteractionStateContext";

export function createPlaybackInteractionStateStore(): StoreApi<PlaybackInteractionStateStore> {
  return createStore((set, get) => {
    let resumePlaybackAfterKeyframeSearch: (() => void) | undefined;

    return {
      keyframeSearchLockCount: 0,

      acquireKeyframeSearchLock: (args?: AcquireKeyframeSearchLockArgs) => {
        const wasInactive = get().keyframeSearchLockCount === 0;
        set((store) => ({ keyframeSearchLockCount: store.keyframeSearchLockCount + 1 }));

        if (args?.pausePlayback != undefined && (wasInactive || args.isPlaying === true)) {
          args.pausePlayback();
        }
        if (args?.isPlaying === true) {
          resumePlaybackAfterKeyframeSearch ??= args.startPlayback;
        }

        let released = false;
        return () => {
          if (released) {
            return;
          }
          released = true;

          let resumePlayback: (() => void) | undefined;
          set((store) => {
            const nextCount = Math.max(0, store.keyframeSearchLockCount - 1);
            if (store.keyframeSearchLockCount > 0 && nextCount === 0) {
              resumePlayback = resumePlaybackAfterKeyframeSearch;
              resumePlaybackAfterKeyframeSearch = undefined;
            }
            return { keyframeSearchLockCount: nextCount };
          });

          resumePlayback?.();
        };
      },
    };
  });
}

export default function PlaybackInteractionStateProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(() => createPlaybackInteractionStateStore());

  return (
    <PlaybackInteractionStateContext.Provider value={store}>
      {children}
    </PlaybackInteractionStateContext.Provider>
  );
}
