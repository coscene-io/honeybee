import { DeepReadonly } from "ts-essentials";
import { Record } from "@coscene-io/coscene/proto/v1alpha2";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { StoreApi, useStore } from "zustand";
import { createContext } from "react";
import useGuaranteedContext from "@foxglove/studio-base/hooks/useGuaranteedContext";

export type BagFiles = {
  [name: string]: Ros1BagMedia;
};

export type CoSceneRecordStore = DeepReadonly<{
  record: AsyncState<Record>;

  recordBagMedia: AsyncState<BagFiles>;

  setRecord: (record: AsyncState<Record>) => void;

  setRecordBagMedia: (bagFile: AsyncState<BagFiles>) => void;
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
