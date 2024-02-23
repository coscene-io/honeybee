// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";

import Log from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useCurrentLayoutActions } from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext";
// import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { AppURLState, parseAppURLState } from "@foxglove/studio-base/util/appURLState";

const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
// const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

const log = Log.getLogger(__filename);

function useSyncLayoutFromUrl(targetUrlState: AppURLState | undefined) {
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const [unappliedLayoutArgs, setUnappliedLayoutArgs] = useState(
    targetUrlState ? { layoutId: targetUrlState.layoutId } : undefined,
  );
  // Select layout from URL.
  useEffect(() => {
    if (!unappliedLayoutArgs?.layoutId) {
      return;
    }
    log.debug(`Initializing layout from url: ${unappliedLayoutArgs.layoutId}`);
    setSelectedLayoutId(unappliedLayoutArgs.layoutId);
    setUnappliedLayoutArgs({ layoutId: undefined });
  }, [playerPresence, setSelectedLayoutId, unappliedLayoutArgs?.layoutId]);
}

// NOT READY FOR PRIME TIME @Woodii1998
// migrate sync time to this

// function useSyncTimeFromUrl(targetUrlState: AppURLState | undefined) {
//   const seekPlayback = useMessagePipeline(selectSeek);
//   const playerPresence = useMessagePipeline(selectPlayerPresence);
//   const [unappliedTime, setUnappliedTime] = useState(
//     targetUrlState ? { time: targetUrlState.time } : undefined,
//   );
//   // Seek to time in URL.
//   useEffect(() => {
//     if (unappliedTime?.time == undefined || !seekPlayback) {
//       return;
//     }

//     // Wait until player is ready before we try to seek.
//     if (playerPresence !== PlayerPresence.PRESENT) {
//       return;
//     }

//     log.debug(`Seeking to url time:`, unappliedTime.time);
//     seekPlayback(unappliedTime.time);
//     setUnappliedTime({ time: undefined });
//   }, [playerPresence, seekPlayback, unappliedTime]);
// }

/**
 * Ensure only one copy of the hook is mounted so we don't trigger side effects like selectSource
 * more than once.
 */
let useInitialDeepLinkStateMounted = false;
/**
 * Restores our session state from any deep link we were passed on startup.
 */
export function useInitialDeepLinkState(deepLinks: readonly string[]): void {
  useEffect(() => {
    if (useInitialDeepLinkStateMounted) {
      throw new Error("Invariant: only one copy of useInitialDeepLinkState may be mounted");
    }
    useInitialDeepLinkStateMounted = true;
    return () => {
      useInitialDeepLinkStateMounted = false;
    };
  }, []);

  const targetUrlState = useMemo(
    () => (deepLinks[0] ? parseAppURLState(new URL(deepLinks[0])) : undefined),
    [deepLinks],
  );

  useSyncLayoutFromUrl(targetUrlState);
  // useSyncTimeFromUrl(targetUrlState);
}
