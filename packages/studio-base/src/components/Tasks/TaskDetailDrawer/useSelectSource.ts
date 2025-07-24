// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback } from "react";

import { BaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", newStateUrl.href);
}

const selectUser = (store: UserStore) => store.user;

export function useVizTargetSource(): ({
  baseInfo,
  sourceId,
}: {
  baseInfo: BaseInfo;
  sourceId: "coscene-data-platform" | "coscene-websocket";
}) => Promise<void> {
  const { selectSource } = usePlayerSelection();
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);

  return useCallback(
    async ({
      baseInfo,
      sourceId,
    }: {
      baseInfo: BaseInfo;
      sourceId: "coscene-data-platform" | "coscene-websocket";
    }) => {
      const key = await consoleApi.setBaseInfo(baseInfo);

      updateUrl({
        dsParams: {
          key,
        },
      });

      selectSource(sourceId, {
        type: "connection",
        params: { ...currentUser, key },
      });
    },
    [selectSource],
  );
}
