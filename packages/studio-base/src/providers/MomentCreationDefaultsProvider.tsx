// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import cloneDeep from "lodash-es/cloneDeep";
import { useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { createStore } from "zustand";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  MomentCreationDefaultsContext,
  type MomentCreationDefaultsStore,
} from "@foxglove/studio-base/context/MomentCreationDefaultsContext";

export default function MomentCreationDefaultsProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const consoleApi = useConsoleApi();
  const warehouseId = useCoreData((store) => store.externalInitConfig?.warehouseId);
  const projectId = useCoreData((store) => store.externalInitConfig?.projectId);
  const userId = useCurrentUser((store) => store.user?.userId);
  const loginStatus = useCurrentUser((store) => store.loginStatus);
  const configuredBaseUrl = useCoreData((store) => store.baseUrl);
  const apiBaseUrl = consoleApi.getBaseUrl();

  // Replacing the store also isolates late create responses from a previous scope,
  // including navigating from A to B and then back to A. Nothing is persisted.
  const store = useMemo(() => {
    const enabled =
      apiBaseUrl.length > 0 &&
      configuredBaseUrl !== "" &&
      warehouseId != undefined &&
      projectId != undefined &&
      userId != undefined &&
      loginStatus === "alreadyLogin";
    return createStore<MomentCreationDefaultsStore>((set) => ({
      id: uuidv4(),
      customFieldValues: [],
      rememberCustomFieldValues: (values) => {
        if (enabled) {
          set({ customFieldValues: cloneDeep(values) });
        }
      },
    }));
  }, [apiBaseUrl, configuredBaseUrl, warehouseId, projectId, userId, loginStatus]);

  return (
    <MomentCreationDefaultsContext.Provider value={store}>
      {children}
    </MomentCreationDefaultsContext.Provider>
  );
}
