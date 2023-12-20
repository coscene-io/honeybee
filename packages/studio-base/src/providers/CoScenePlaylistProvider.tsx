// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  CoScenePlaylistContext,
  CoScenePlaylistStore,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";

function createPlaylistStore() {
  return createStore<CoScenePlaylistStore>((set) => ({
    bagFiles: { loading: false, value: [] },
    setBagFiles: (bagFiles: AsyncState<BagFileInfo[]>) => {
      set({ bagFiles });
    },
    setCurrentBagFiles: (bagFiles: BagFileInfo[]) => {
      set({ currentBagFiles: bagFiles });
    },
  }));
}

export default function CoScenePlaylistProvider({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [store] = useState(createPlaylistStore);

  return (
    <CoScenePlaylistContext.Provider value={store}>{children}</CoScenePlaylistContext.Provider>
  );
}
