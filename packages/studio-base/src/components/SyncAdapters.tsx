// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import { CurrentLayoutSyncAdapter } from "@foxglove/studio-base/components/CoSceneCurrentLayoutSyncAdapter";
import { CoSceneEventsSyncAdapter } from "@foxglove/studio-base/components/CoSceneEventsSyncAdapter";
import { ProjectsSyncAdapter } from "@foxglove/studio-base/components/CoSceneProjectSyncAdapter";
import { RecordsSyncAdapter } from "@foxglove/studio-base/components/CoSceneRecordSyncAdapter";
// import { CurrentLayoutLocalStorageSyncAdapter } from "@foxglove/studio-base/components/CurrentLayoutLocalStorageSyncAdapter";
import { URLStateSyncAdapter } from "@foxglove/studio-base/components/URLStateSyncAdapter";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";

export function SyncAdapters(): JSX.Element {
  // Sync adapters from app context override any local sync adapters
  const { syncAdapters } = useAppContext();

  return useMemo(() => {
    if (syncAdapters) {
      return <>{...syncAdapters}</>;
    }

    return (
      <>
        <CoSceneEventsSyncAdapter />
        <RecordsSyncAdapter />
        <ProjectsSyncAdapter />
        <URLStateSyncAdapter />
        <CurrentLayoutSyncAdapter />
      </>
    );
  }, [syncAdapters]);
}
