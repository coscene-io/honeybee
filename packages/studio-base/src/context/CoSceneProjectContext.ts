// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/coscene/proto/v1alpha1";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { DeepReadonly } from "ts-essentials";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type CoSceneProjectStore = DeepReadonly<{
  project: AsyncState<Project>;

  setProject: (project: AsyncState<Project>) => void;
}>;

export const CoSceneProjectContext = createContext<undefined | StoreApi<CoSceneProjectStore>>(
  undefined,
);

export function useProject<T>(selector: (store: CoSceneProjectStore) => T): T {
  const context = useGuaranteedContext(CoSceneProjectContext);
  return useStore(context, selector);
}
