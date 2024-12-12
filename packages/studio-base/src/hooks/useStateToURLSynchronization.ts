// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// import * as _ from "lodash-es";
import { useEffect } from "react";
import { useDebounce } from "use-debounce";

// import { useDeepMemo } from "@foxglove/hooks";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
// import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext";
import { PlayerCapabilities } from "@foxglove/studio-base/players/types";
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";

const selectCanSeek = (ctx: MessagePipelineContext) =>
  ctx.playerState.capabilities.includes(PlayerCapabilities.playbackControl);
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectLayoutId = (layoutState: LayoutState) => layoutState.selectedLayout?.id;
// const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
// const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", newStateUrl.href);
}

/**
 * Syncs our current player state and time with the URL in the address bar.
 * CoScene do not sync stablePlayerUrlState.parameters
 */
export function useStateToURLSynchronization(): void {
  // const playerUrlState = useMessagePipeline(selectUrlState);
  // const stablePlayerUrlState = useDeepMemo(playerUrlState);
  const canSeek = useMessagePipeline(selectCanSeek);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [debouncedCurrentTime] = useDebounce(currentTime, 500, { maxWait: 500 });
  const layoutId = useCurrentLayoutSelector(selectLayoutId);
  // const selectedEventId = useEvents(selectSelectedEventId);

  // Sync layoutId with the url.
  useEffect(() => {
    if (layoutId == undefined) {
      return;
    }

    updateUrl({ layoutId });
  }, [layoutId]);

  // Sync current time with the url.
  useEffect(() => {
    updateUrl({
      time: canSeek ? debouncedCurrentTime : undefined,
    });
  }, [canSeek, debouncedCurrentTime]);

  // Sync player state with the url.
  // useEffect(() => {
  //   if (stablePlayerUrlState == undefined) {
  //     return;
  //   }

  //   updateUrl({
  //     ds: stablePlayerUrlState.sourceId,
  //     dsParams: _.pickBy(
  //       {
  //         ...stablePlayerUrlState.parameters,
  //         eventId: selectedEventId,
  //       },
  //       _.isString,
  //     ),
  //   });
  // }, [selectedEventId, stablePlayerUrlState]);
}
