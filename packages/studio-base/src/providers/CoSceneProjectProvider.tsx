// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/coscene/proto/v1alpha1";
import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  CoSceneProjectContext,
  CoSceneProjectStore,
} from "@foxglove/studio-base/context/CoSceneProjectContext";

function createProjectStore() {
  return createStore<CoSceneProjectStore>((set) => ({
    project: { loading: false, value: new Project() },
    setProject: (project: AsyncState<Project>) => {
      set({ project });
    },
  }));
}

export default function CoSceneProjectProvider({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [store] = useState(createProjectStore);

  return <CoSceneProjectContext.Provider value={store}>{children}</CoSceneProjectContext.Provider>;
}
