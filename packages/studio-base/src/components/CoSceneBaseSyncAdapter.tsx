// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

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
      consoleApi.setType("playback");
      try {
        setBaseInfo({ loading: true, value: {} });
        const baseInfo = await consoleApi.getBaseInfo(baseInfoKey);

        // Hack: if baseInfo.files has only one file, set isStandalonePlayback to true
        if (baseInfo.files && baseInfo.files.length === 1 && "filename" in baseInfo.files[0]!) {
          baseInfo.isStandalonePlayback = true;
        }

        setBaseInfo({ loading: false, value: baseInfo });
        consoleApi.setApiBaseInfo(baseInfo);
      } catch (error) {
        setBaseInfo({ loading: false, error });
      }
    } else {
      // if no shorturl key, this is a ws realtime link
      consoleApi.setType("realtime");
    }
  }, [consoleApi, setBaseInfo]);

  useEffect(() => {
    syncBaseInfo().catch((error: unknown) => {
      log.error("Failed to sync base info", error);
    });
  }, [syncBaseInfo]);

  return ReactNull;
}
