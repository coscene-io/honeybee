// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
import { useAsync } from "react-use";

import Log from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { LayoutState, useCurrentLayoutActions, useCurrentLayoutSelector } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { AppURLState, parseAppURLState } from "@foxglove/studio-base/util/appURLState";

const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

const log = Log.getLogger(__filename);

function useSyncLayoutFromUrl(targetUrlState: AppURLState | undefined) {
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const { layoutDrawer } = useWorkspaceActions();
  const layoutManager = useLayoutManager();

  const [{ isInitialized, layoutId, dsParamsKey }, setUnappliedLayoutArgs] = useState(
    targetUrlState ? {
      isInitialized: false,
      layoutId: targetUrlState.layoutId,
      dsParamsKey: targetUrlState.dsParams?.key
    } : {
      isInitialized: false,
      layoutId: undefined,
      dsParamsKey: undefined
    },
  );

  // Select layout from URL.
  // if loginStatus is alreadyLogin, we need to check if remoteLayoutStorage is ready
  useAsync(async () => {
    if (currentLayoutId || isInitialized) {
      return;
    }

    // Don't restore the layout if there's one specified in the app state url.
    if (layoutId) {
      const urlLayout = await layoutManager.getLayout({ id: layoutId });
      if (urlLayout) {
        setSelectedLayoutId(layoutId);
        setUnappliedLayoutArgs({ isInitialized: true, layoutId: undefined, dsParamsKey: undefined });
        return;
      }
    }

    // waiting for loading projectName done
    if (dsParamsKey && layoutManager.projectName == undefined) {
      setUnappliedLayoutArgs({ isInitialized: false, layoutId: undefined, dsParamsKey: undefined });
      return;
    }

    const layout = await layoutManager.getHistory();
    if (layout) {
      setSelectedLayoutId(layout.id);
      setUnappliedLayoutArgs({ isInitialized: true, layoutId: undefined, dsParamsKey: undefined });
      return;
    }

    // // open drawer
    layoutDrawer.open();
    setUnappliedLayoutArgs({ isInitialized: true, layoutId: undefined, dsParamsKey: undefined });
  }, [
    currentLayoutId,
    setSelectedLayoutId,
    isInitialized,
    layoutId,
    dsParamsKey,
    layoutManager,
    layoutDrawer,
  ]);
}

function useSyncTimeFromUrl(targetUrlState: AppURLState | undefined) {
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
  useSyncTimeFromUrl(targetUrlState);
}
