import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import { Record } from "@coscene-io/coscene/proto/v1alpha2";

import {
  CoSceneRecordContext,
  CoSceneRecordStore,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoSceneRecordContext";

function createRecordStore() {
  return createStore<CoSceneRecordStore>((set) => ({
    record: { loading: false, value: new Record() },
    recordBagFiles: { loading: false, value: [] },
    setRecord: (record: AsyncState<Record>) => set({ record: record }),
    setRecordBagFiles: (recordBagFiles: AsyncState<BagFileInfo[]>) => set({ recordBagFiles }),
    setCurrentBagFiles: (bagFiles: BagFileInfo[]) => set({ currentBagFiles: bagFiles }),
  }));
}

export default function CoSceneRecordProvider({ children }: { children?: ReactNode }): JSX.Element {
  const [store] = useState(createRecordStore);

  return <CoSceneRecordContext.Provider value={store}>{children}</CoSceneRecordContext.Provider>;
}
