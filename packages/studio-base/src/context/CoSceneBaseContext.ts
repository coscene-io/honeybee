// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { DeepReadonly } from "ts-essentials";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type BaseInfo = {
  projectId?: string;
  projectSlug?: string;
  recordDisplayName?: string;
  recordId?: string;
  warehouseId?: string;
  warehouseSlug?: string;
  jobRunsDisplayName?: string;
  jobRunsId?: string;
  workflowRunsId?: string;
  files?: Array<{ jobRunsName: string } | { filename: string }>;
};

export type CoSceneBaseStore = DeepReadonly<{
  baseInfo: AsyncState<BaseInfo>;
  setBaseInfo: (baseInfo: AsyncState<BaseInfo>) => void;
}>;

export const CoSceneBaseContext = createContext<undefined | StoreApi<CoSceneBaseStore>>(undefined);

export function useBaseInfo<T>(selector: (store: CoSceneBaseStore) => T): T {
  const context = useGuaranteedContext(CoSceneBaseContext);
  return useStore(context, selector);
}
