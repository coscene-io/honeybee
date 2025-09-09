// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// import * as _ from "lodash-es";
import { useEffect } from "react";
import { useEffectOnce } from "react-use";

import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
const selectedProjectName = (store: CoreDataStore) => {
  return store.externalInitConfig?.warehouseId && store.externalInitConfig.projectId
    ? `warehouses/${store.externalInitConfig.warehouseId}/projects/${store.externalInitConfig.projectId}`
    : undefined;
};
const selectUserName = (store: UserStore) =>
  store.user?.userId ? `users/${store.user.userId}` : undefined;

export function useLayoutHistory(): void {
  const layoutManager = useLayoutManager();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);

  const loadedLayoutId = currentLayoutId;
  // !!currentLayoutId && currentLayout === currentLayout?.id ? currentLayoutId : undefined;
  const projectName = useCoreData(selectedProjectName);
  const currentUserName = useCurrentUser(selectUserName);
  const currentParent = projectName ?? currentUserName ?? "local";

  useEffectOnce(() => {
    const url = new URL(window.location.href);
    const layoutId = url.searchParams.get("layoutId");
    const dskey = url.searchParams.get("ds.key");
    console.log("dskey", dskey, "layoutId", layoutId);
  });

  useEffect(() => {
    if (loadedLayoutId) {
      void layoutManager.putHistory({
        id: loadedLayoutId,
        parent: currentParent,
      });
    }
  }, [loadedLayoutId, layoutManager, currentParent]);
}
