// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import RemoteLayoutStorageContext from "@foxglove/studio-base/context/CoSceneRemoteLayoutStorageContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import ConsoleApiRemoteLayoutStorage from "@foxglove/studio-base/services/CoSceneConsoleApiRemoteLayoutStorage";

const selectUser = (store: UserStore) => store.user;
const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;

export default function CoSceneConsoleApiRemoteLayoutStorageProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const api = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);
  const externalInitConfig = useCoreData(selectExternalInitConfig);

  const projectName =
    externalInitConfig?.warehouseId && externalInitConfig.projectId
      ? `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`
      : undefined;

  const apiStorage = useMemo(
    () =>
      currentUser?.userId
        ? new ConsoleApiRemoteLayoutStorage(
            currentUser.userId,
            api,
            currentUser.userId,
            projectName,
          )
        : undefined,
    [api, currentUser?.userId, projectName],
  );

  return (
    <RemoteLayoutStorageContext.Provider value={apiStorage}>
      {children}
    </RemoteLayoutStorageContext.Provider>
  );
}
