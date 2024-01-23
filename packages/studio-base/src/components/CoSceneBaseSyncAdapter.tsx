// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const log = Logger.getLogger(__filename);

const selectSetBaseInfo = (state: CoSceneBaseStore) => state.setBaseInfo;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function CoSceneBaseSyncAdapter(): ReactNull {
  const setBaseInfo = useBaseInfo(selectSetBaseInfo);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();

  const [_baseInfo, syncBaseInfo] = useAsyncFn(async () => {
    if (urlState?.parameters?.key) {
      try {
        setBaseInfo({ loading: true, value: {} });
        const baseInfo = await consoleApi.getBaseInfo(urlState.parameters.key);

        setBaseInfo({ loading: false, value: baseInfo });
      } catch (error) {
        setBaseInfo({ loading: false, error });
      }
    }
  }, [consoleApi, setBaseInfo, urlState?.parameters?.key]);

  useEffect(() => {
    syncBaseInfo().catch((error) => {
      log.error("Failed to sync base info", error);
    });
  }, [syncBaseInfo]);

  return ReactNull;
}
