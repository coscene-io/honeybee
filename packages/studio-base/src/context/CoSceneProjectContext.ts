import { DeepReadonly } from "ts-essentials";
import { Project } from "@coscene-io/coscene/proto/v1alpha1";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";
import { createContext } from "react";
import useGuaranteedContext from "@foxglove/studio-base/hooks/useGuaranteedContext";

export type CoSceneProjectStore = DeepReadonly<{
  project: AsyncState<Project>;

  setProject: (project: AsyncState<Project>) => void;
}>;

export const CoSceneProjectContext = createContext<undefined | StoreApi<CoSceneProjectStore>>(
  undefined,
);

export function useProject<T>(
  selector: (store: CoSceneProjectStore) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const context = useGuaranteedContext(CoSceneProjectContext);
  return useStore(context, selector, equalityFn);
}
