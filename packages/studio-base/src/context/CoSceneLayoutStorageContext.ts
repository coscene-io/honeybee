// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { ILayoutStorage } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const CoSceneLayoutStorageContext = createContext<ILayoutStorage | undefined>(undefined);
CoSceneLayoutStorageContext.displayName = "CoSceneLayoutStorageContext";

export function useLayoutStorage(): ILayoutStorage {
  const ctx = useContext(CoSceneLayoutStorageContext);
  if (ctx == undefined) {
    throw new Error("A LayoutStorage provider is required to useLayoutStorage");
  }
  return ctx;
}

export default CoSceneLayoutStorageContext;
