// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const log = Logger.getLogger(__filename);

const selectSetBaseInfo = (state: CoSceneBaseStore) => state.setBaseInfo;

export function CoSceneBaseSyncAdapter(): ReactNull {
  const setBaseInfo = useBaseInfo(selectSetBaseInfo);
  const consoleApi = useConsoleApi();

  const [_baseInfo, syncBaseInfo] = useAsyncFn(async () => {
    const url = new URL(window.location.href);

    const baseInfoKey = decodeURI(url.searchParams.get("ds.key") ?? "");

    if (baseInfoKey) {
      try {
        setBaseInfo({ loading: true, value: {} });
        const baseInfo = await consoleApi.getBaseInfo(baseInfoKey);

        if (!baseInfo.projectId || !baseInfo.recordId) {
          throw new Error("Base info is missing project or record id");
        }

        consoleApi.setProjectId(baseInfo.projectId);
        consoleApi.setRecordId(baseInfo.recordId);

        setBaseInfo({ loading: false, value: baseInfo });
      } catch (error) {
        setBaseInfo({ loading: false, error });
      }
    }
  }, [consoleApi, setBaseInfo]);

  useEffect(() => {
    syncBaseInfo().catch((error) => {
      log.error("Failed to sync base info", error);
    });
  }, [syncBaseInfo]);

  return ReactNull;
}
