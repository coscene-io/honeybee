import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import { Project } from "@coscene-io/coscene/proto/v1alpha1";

import {
  CoSceneProjectContext,
  CoSceneProjectStore,
} from "@foxglove/studio-base/context/CoSceneProjectContext";

function createProjectStore() {
  return createStore<CoSceneProjectStore>((set) => ({
    project: { loading: false, value: new Project() },
    setProject: (project: AsyncState<Project>) => set({ project: project }),
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
