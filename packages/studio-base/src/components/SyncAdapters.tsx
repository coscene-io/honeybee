// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import { CurrentLayoutSyncAdapter } from "@foxglove/studio-base/components/CoSceneCurrentLayoutSyncAdapter";
import { CoSceneCurrentUserSyncAdapter } from "@foxglove/studio-base/components/CoSceneCurrentUserSyncAdapter";
import { CoSceneEventsSyncAdapter } from "@foxglove/studio-base/components/CoSceneEventsSyncAdapter";
import { PlaylistSyncAdapter } from "@foxglove/studio-base/components/CoScenePlaylistSyncAdapter";
import { ProjectsSyncAdapter } from "@foxglove/studio-base/components/CoSceneProjectSyncAdapter";
import { URLStateSyncAdapter } from "@foxglove/studio-base/components/URLStateSyncAdapter";
// import { UpdateChecker } from "@foxglove/studio-base/components/UpdateChecker";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";

export function SyncAdapters(): React.JSX.Element {
  // Sync adapters from app context override any local sync adapters
  const { syncAdapters } = useAppContext();

  return useMemo(() => {
    if (syncAdapters) {
      return <>{...syncAdapters}</>;
    }

    return (
      <>
        <CoSceneCurrentUserSyncAdapter />
        <CoSceneEventsSyncAdapter />
        <PlaylistSyncAdapter />
        <ProjectsSyncAdapter />
        <URLStateSyncAdapter />
        <CurrentLayoutSyncAdapter />
        {/* <UpdateChecker /> */}
      </>
    );
  }, [syncAdapters]);
}
