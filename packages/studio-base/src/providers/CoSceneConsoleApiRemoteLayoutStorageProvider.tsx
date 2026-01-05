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
import { windowAppURLState } from "@foxglove/studio-base/util/appURLState";

const selectProjectName = (state: CoreDataStore) =>
  state.externalInitConfig?.projectId && state.externalInitConfig.warehouseId
    ? `warehouses/${state.externalInitConfig.warehouseId}/projects/${state.externalInitConfig.projectId}`
    : undefined;

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

export default function CoSceneConsoleApiRemoteLayoutStorageProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const api = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectLoginStatus);
  const projectName = useCoreData(selectProjectName);

  const enabled = useMemo(() => {
    if (currentUser?.userId == undefined || loginStatus !== "alreadyLogin") {
      return false;
    }

    const urlState = windowAppURLState();
    const hasDataSourceKey = urlState?.dsParams?.key != undefined;

    // Enable if no data source key is present, or if both data source key and project name are present
    return !hasDataSourceKey || projectName != undefined;
  }, [currentUser?.userId, loginStatus, projectName]);

  const apiStorage = useMemo(
    () =>
      enabled && currentUser?.userId
        ? new ConsoleApiRemoteLayoutStorage(
            currentUser.userId,
            `users/${currentUser.userId}`,
            projectName,
            api,
          )
        : undefined,
    [api, enabled, currentUser?.userId, projectName],
  );

  return (
    <RemoteLayoutStorageContext.Provider value={apiStorage}>
      {children}
    </RemoteLayoutStorageContext.Provider>
  );
}
