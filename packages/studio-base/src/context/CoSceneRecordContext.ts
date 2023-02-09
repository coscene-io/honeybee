// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { Record } from "@coscene-io/coscene/proto/v1alpha2";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { DeepReadonly } from "ts-essentials";
import { StoreApi, useStore } from "zustand";

import { Time } from "@foxglove/rostime";
import useGuaranteedContext from "@foxglove/studio-base/hooks/useGuaranteedContext";

export type BagFileInfo = {
  name: string;

  displayName: string;

  startTime?: Time;

  endTime?: Time;

  /** The end position of the bag, as a value 0-1 relative to the timeline. */
  endPosition?: number;

  /** The start position of the bag, as a value 0-1 relative to the timeline. */
  startPosition?: number;

  /** The time, in seconds, relative to the start of the timeline. */
  secondsSinceStart?: number;

  media?: Ros1BagMedia;
};

export type CoSceneRecordStore = DeepReadonly<{
  record: AsyncState<Record>;

  recordBagFiles: AsyncState<BagFileInfo[]>;

  currentBagFiles?: BagFileInfo[];

  setRecord: (record: AsyncState<Record>) => void;

  setRecordBagFiles: (bagFile: AsyncState<BagFileInfo[]>) => void;

  setCurrentBagFiles: (bagFile: BagFileInfo[]) => void;
}>;

export const CoSceneRecordContext = createContext<undefined | StoreApi<CoSceneRecordStore>>(
  undefined,
);

export function useRecord<T>(
  selector: (store: CoSceneRecordStore) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const context = useGuaranteedContext(CoSceneRecordContext);
  return useStore(context, selector, equalityFn);
}
