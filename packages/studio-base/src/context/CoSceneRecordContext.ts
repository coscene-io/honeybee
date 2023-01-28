import { DeepReadonly } from "ts-essentials";
import { Record } from "@coscene-io/coscene/proto/v1alpha2";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { StoreApi, useStore } from "zustand";
import { createContext } from "react";
import useGuaranteedContext from "@foxglove/studio-base/hooks/useGuaranteedContext";
import { Time } from "@foxglove/rostime";

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
