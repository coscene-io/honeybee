// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";

import Log from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

const log = Log.getLogger(__filename);

/**
 * Synchronizes the playback time from URL state when player is ready
 */
export function useSyncTimeFromUrl(targetUrlState: AppURLState | undefined): void {
  const seekPlayback = useMessagePipeline(selectSeek);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const [isAppliedTime, setIsAppliedTime] = useState(false);

  const time = targetUrlState?.time;

  // Wait until player is ready before we try to seek.
  // Seek to time in URL.
  useEffect(() => {
    if (
      playerPresence !== PlayerPresence.PRESENT ||
      !seekPlayback ||
      isAppliedTime ||
      time == undefined
    ) {
      return;
    }

    log.debug(`Seeking to url time:`, time);
    seekPlayback(time);
    setIsAppliedTime(true);
  }, [playerPresence, seekPlayback, isAppliedTime, time]);
}
