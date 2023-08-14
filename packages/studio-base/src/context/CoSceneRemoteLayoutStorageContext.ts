// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { IRemoteLayoutStorage } from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";

const CoSceneRemoteLayoutStorageContext = createContext<IRemoteLayoutStorage | undefined>(
  undefined,
);
CoSceneRemoteLayoutStorageContext.displayName = "CoSceneRemoteLayoutStorageContext";

export function useRemoteLayoutStorage(): IRemoteLayoutStorage | undefined {
  return useContext(CoSceneRemoteLayoutStorageContext);
}

// ts-prune-ignore-next
export default CoSceneRemoteLayoutStorageContext;
