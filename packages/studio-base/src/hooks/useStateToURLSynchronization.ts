// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";
import { useDebounce } from "use-debounce";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { PlayerCapabilities, PlayerPresence } from "@foxglove/studio-base/players/types";
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";
import { getBrowserSession } from "@foxglove/studio-base/util/browserSession";

const selectCanSeek = (ctx: MessagePipelineContext) =>
  ctx.playerState.capabilities.includes(PlayerCapabilities.playbackControl);
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectLayoutIdForUrlSync = (layoutState: LayoutState) =>
  layoutState.selectedLayout?.transient === true ? undefined : layoutState.selectedLayout?.id;

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", newStateUrl.href);
}

/**
 * Syncs our current player state and time with the URL in the address bar.
 * CoScene do not sync stablePlayerUrlState.parameters
 */
export function useStateToURLSynchronization(): void {
  const canSeek = useMessagePipeline(selectCanSeek);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [debouncedCurrentTime] = useDebounce(currentTime, 500, { maxWait: 500 });
  const layoutId = useCurrentLayoutSelector(selectLayoutIdForUrlSync);

  const latest = useRef({ currentTime, layoutId });
  latest.current = { currentTime, layoutId };
  useEffect(() => {
    const session = getBrowserSession();
    return session?.subscribe(() => {
      if (session.preservesPlayback() || session.getStatus() === "current") return;
      // Capture the exact position before player teardown; do not wait for debounce.
      const snapshot = latest.current;
      if (snapshot.currentTime != undefined) updateUrl({ time: snapshot.currentTime });
      if (snapshot.layoutId != undefined) updateUrl({ layoutId: snapshot.layoutId });
    });
  }, []);

  // Sync layoutId with the url.
  useEffect(() => {
    const session = getBrowserSession();
    if (session && !session.preservesPlayback() && session.getStatus() !== "current") return;
    if (layoutId == undefined) {
      return;
    }

    updateUrl({ layoutId });
  }, [layoutId]);

  // Sync current time with the url.
  useEffect(() => {
    const session = getBrowserSession();
    if (session && !session.preservesPlayback() && session.getStatus() !== "current") return;
    // Keep the launch seek time while authentication and player initialization are pending.
    if (canSeek && debouncedCurrentTime != undefined) {
      updateUrl({ time: debouncedCurrentTime });
    } else if (playerPresence === PlayerPresence.PRESENT && !canSeek) {
      updateUrl({ time: undefined });
    }
  }, [canSeek, debouncedCurrentTime, playerPresence]);
}
