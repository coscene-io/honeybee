// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { enqueueSnackbar } from "notistack";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAsync, useMountedState } from "react-use";
import { useDebounce } from "use-debounce";

import Logger from "@foxglove/log";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  LayoutID,
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { isLayoutEqual } from "@foxglove/studio-base/services/LayoutManager/compareLayouts";

type UpdatedLayout = NonNullable<LayoutState["selectedLayout"]>;
type RetryState = {
  failed: Map<LayoutID, UpdatedLayout>;
  ready: Set<LayoutID>;
  delayMs: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const log = Logger.getLogger(__filename);

const EMPTY_UNSAVED_LAYOUTS: Record<LayoutID, UpdatedLayout> = {};
const SAVE_INTERVAL_MS = 1000;
const MAX_SAVE_RETRY_INTERVAL_MS = 30_000;

const selectCurrentLayout = (state: LayoutState) => state.selectedLayout;

function cleanLayoutInvalidatesPending(
  cleanLayout: UpdatedLayout,
  pendingLayout: UpdatedLayout,
): boolean {
  if (
    cleanLayout.data != undefined &&
    pendingLayout.data != undefined &&
    isLayoutEqual(cleanLayout.data, pendingLayout.data)
  ) {
    return true;
  }
  return (
    cleanLayout.editRevision != undefined &&
    (pendingLayout.editRevision == undefined ||
      cleanLayout.editRevision > pendingLayout.editRevision)
  );
}

/**
 * Observes changes in the current layout and asynchronously pushes them to the
 * layout manager.
 */
export function CurrentLayoutSyncAdapter(): ReactNull {
  const selectedLayout = useCurrentLayoutSelector(selectCurrentLayout);

  const layoutManager = useLayoutManager();

  const [unsavedLayouts, setUnsavedLayouts] = useState(EMPTY_UNSAVED_LAYOUTS);
  const unsavedLayoutsRef = useRef(unsavedLayouts);
  const [retryState] = useState<RetryState>(() => ({
    failed: new Map<LayoutID, UpdatedLayout>(),
    ready: new Set<LayoutID>(),
    delayMs: SAVE_INTERVAL_MS,
    timer: undefined,
  }));
  useEffect(() => {
    unsavedLayoutsRef.current = unsavedLayouts;
  }, [unsavedLayouts]);

  const clearRetry = useCallback(
    (id: LayoutID) => {
      retryState.failed.delete(id);
      retryState.ready.delete(id);
      if (retryState.failed.size === 0) {
        if (retryState.timer != undefined) {
          clearTimeout(retryState.timer);
          retryState.timer = undefined;
        }
        retryState.delayMs = SAVE_INTERVAL_MS;
      }
    },
    [retryState],
  );

  const scheduleRetry = useCallback(() => {
    if (retryState.timer != undefined || retryState.failed.size === 0) {
      return;
    }
    const delayMs = retryState.delayMs;
    retryState.delayMs = Math.min(MAX_SAVE_RETRY_INTERVAL_MS, delayMs * 2);
    retryState.timer = setTimeout(() => {
      retryState.timer = undefined;
      for (const id of retryState.failed.keys()) {
        retryState.ready.add(id);
      }
      setUnsavedLayouts((old) => ({ ...old }));
    }, delayMs);
  }, [retryState]);

  const analytics = useAnalytics();

  const isMounted = useMountedState();

  useEffect(() => {
    if (selectedLayout?.edited === true && selectedLayout.transient !== true) {
      clearRetry(selectedLayout.id);
      setUnsavedLayouts((old) => ({
        ...old,
        [selectedLayout.id]: selectedLayout,
      }));
    } else if (selectedLayout?.id != undefined) {
      const pendingLayout = unsavedLayoutsRef.current[selectedLayout.id];
      if (
        pendingLayout != undefined &&
        cleanLayoutInvalidatesPending(selectedLayout, pendingLayout)
      ) {
        clearRetry(selectedLayout.id);
      }
      setUnsavedLayouts((old) => {
        const pending = old[selectedLayout.id];
        if (pending == undefined || !cleanLayoutInvalidatesPending(selectedLayout, pending)) {
          return old;
        }
        const newUnsavedLayouts = { ...old };
        delete newUnsavedLayouts[selectedLayout.id];
        return Object.keys(newUnsavedLayouts).length === 0
          ? EMPTY_UNSAVED_LAYOUTS
          : newUnsavedLayouts;
      });
    }
  }, [clearRetry, selectedLayout]);

  const [debouncedUnsavedLayouts, debouncedUnsavedLayoutActions] = useDebounce(
    unsavedLayouts,
    SAVE_INTERVAL_MS,
  );

  // Flush and clear pending updates on unmount.
  useEffect(() => {
    return () => {
      debouncedUnsavedLayoutActions.flush();
      debouncedUnsavedLayoutActions.cancel();
      const retryTimer = retryState.timer;
      if (retryTimer != undefined) {
        clearTimeout(retryTimer);
      }
    };
  }, [debouncedUnsavedLayoutActions, retryState]);

  // Write all pending layout updates to the layout manager. Under the hood this
  // uses useEffect so it happens after DOM updates are complete.
  useAsync(async () => {
    const unsavedLayoutsSnapshot = { ...debouncedUnsavedLayouts };
    const successIds: LayoutID[] = [];
    const failedLayouts: UpdatedLayout[] = [];

    for (const params of Object.values(unsavedLayoutsSnapshot)) {
      try {
        if (unsavedLayoutsRef.current[params.id] !== params) {
          continue;
        }
        if (retryState.failed.get(params.id) === params && !retryState.ready.delete(params.id)) {
          continue;
        }
        await layoutManager.updateLayout({
          id: params.id,
          data: params.data,
          editRevision: params.editRevision,
        });
        clearRetry(params.id);
        successIds.push(params.id);
      } catch (error) {
        failedLayouts.push(params);
        retryState.failed.set(params.id, params);
        retryState.ready.delete(params.id);
        log.error("changes could not be saved", error);

        if (isMounted()) {
          const message = error instanceof Error ? error.toString() : String(error);
          enqueueSnackbar(`Your changes could not be saved. ${message}`, {
            variant: "error",
            key: "CurrentLayoutProvider.throttledSave",
          });
        }
      }
    }

    if (successIds.length > 0) {
      setUnsavedLayouts((old) => {
        const newUnsavedLayouts = { ...old };
        for (const id of successIds) {
          if (newUnsavedLayouts[id] === unsavedLayoutsSnapshot[id]) {
            delete newUnsavedLayouts[id];
          }
        }
        return Object.keys(newUnsavedLayouts).length === 0
          ? EMPTY_UNSAVED_LAYOUTS
          : newUnsavedLayouts;
      });
    }

    if (failedLayouts.length > 0) {
      scheduleRetry();
    }

    if (successIds.length > 0) {
      void analytics.logEvent(AppEvent.LAYOUT_UPDATE);
    }
  }, [
    analytics,
    clearRetry,
    debouncedUnsavedLayouts,
    isMounted,
    layoutManager,
    retryState,
    scheduleRetry,
  ]);

  return ReactNull;
}
