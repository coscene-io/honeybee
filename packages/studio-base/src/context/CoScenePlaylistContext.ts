// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { DeepReadonly } from "ts-essentials";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { Time } from "@foxglove/rostime";

export type PlaylistMediaStatues = "PROCESSING" | "OK" | "ERROR" | "GENERATED_SUCCESS";

export type BagFileInfo = {
  name: string;

  displayName: string;

  startTime?: Time;

  endTime?: Time;

  fileType?: "NORMAL_FILE" | "GHOST_RESULT_FILE" | "GHOST_SOURCE_FILE";

  projectDisplayName?: string;

  recordDisplayName?: string;

  recordColor?: string;

  mediaStatues: PlaylistMediaStatues;

  /** The end position of the bag, as a value 0-1 relative to the timeline. */
  endPosition?: number;

  /** The start position of the bag, as a value 0-1 relative to the timeline. */
  startPosition?: number;

  /** The time, in seconds, relative to the start of the timeline. */
  secondsSinceStart?: number;

  sha256: string;
};

export type CoScenePlaylistStore = DeepReadonly<{
  bagFiles: AsyncState<BagFileInfo[]>;

  currentBagFiles?: BagFileInfo[];

  setBagFiles: (bagFile: AsyncState<BagFileInfo[]>) => void;

  setCurrentBagFiles: (bagFile: BagFileInfo[]) => void;
}>;

export type ParamsFile =
  | {
      filename: string;
      sha256: string;
    }
  | {
      jobRunsName: string;
    }
  | {
      recordName: string;
    };

export const CoScenePlaylistContext = createContext<undefined | StoreApi<CoScenePlaylistStore>>(
  undefined,
);

export function usePlaylist<T>(selector: (store: CoScenePlaylistStore) => T): T {
  const context = useGuaranteedContext(CoScenePlaylistContext);
  return useStore(context, selector);
}
