// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo } from "react";
import { useNetworkState } from "react-use";

import { useVisibilityState } from "@foxglove/hooks";
import Logger from "@foxglove/log";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import LayoutManagerContext from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useLayoutStorage } from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import { useRemoteLayoutStorage } from "@foxglove/studio-base/context/CoSceneRemoteLayoutStorageContext";
import LayoutManager from "@foxglove/studio-base/services/LayoutManager/CoSceneLayoutManager";
import delay from "@foxglove/studio-base/util/delay";

const log = Logger.getLogger(__filename);

const SYNC_INTERVAL_BASE_MS = 30_000;
const SYNC_INTERVAL_MAX_MS = 3 * 60_000;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

export default function CoSceneLayoutManagerProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const layoutStorage = useLayoutStorage();
  const remoteLayoutStorage = useRemoteLayoutStorage();
  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const currentUserLoginStatus = useCurrentUser(selectLoginStatus);

  const layoutManager = useMemo(
    () => new LayoutManager({ local: layoutStorage, remote: remoteLayoutStorage }),
    [layoutStorage, remoteLayoutStorage],
  );

  const { online = false } = useNetworkState();
  const visibilityState = useVisibilityState();

  useEffect(() => {
    layoutManager.setOnline(online);
  }, [layoutManager, online]);

  // Sync periodically when logged in, online, and the app is not hidden
  const enableSyncing =
    remoteLayoutStorage != undefined &&
    online &&
    visibilityState === "visible" &&
    currentUserLoginStatus === "alreadyLogin";

  useEffect(() => {
    // if base info is loaded, resync layouts
    if (!enableSyncing || asyncBaseInfo.loading) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          await layoutManager.syncWithRemote(controller.signal);
          failures = 0;
        } catch (error) {
          log.error("Sync failed:", error);
          failures++;
        }
        // Exponential backoff with jitter:
        // https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
        const duration =
          Math.random() * Math.min(SYNC_INTERVAL_MAX_MS, SYNC_INTERVAL_BASE_MS * 2 ** failures);
        log.debug("Waiting", (duration / 1000).toFixed(2), "sec for next sync", { failures });
        await delay(duration);
      }
    })();
    return () => {
      log.debug("Canceling layout sync due to effect cleanup callback");
      controller.abort();
    };
  }, [enableSyncing, layoutManager, asyncBaseInfo.loading]);

  return (
    <LayoutManagerContext.Provider value={layoutManager}>{children}</LayoutManagerContext.Provider>
  );
}
