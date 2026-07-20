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
  const previousSelectedLayoutIdRef = useRef(selectedLayout?.id);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const retryDelayMsRef = useRef(SAVE_INTERVAL_MS);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    unsavedLayoutsRef.current = unsavedLayouts;
  }, [unsavedLayouts]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current != undefined) {
      return;
    }
    const delayMs = retryDelayMsRef.current;
    retryDelayMsRef.current = Math.min(MAX_SAVE_RETRY_INTERVAL_MS, delayMs * 2);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      setRetryToken((value) => value + 1);
    }, delayMs);
  }, []);

  const analytics = useAnalytics();

  const isMounted = useMountedState();

  useEffect(() => {
    if (selectedLayout?.edited === true && selectedLayout.transient !== true) {
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
        setUnsavedLayouts((old) => {
          if (old[selectedLayout.id] !== pendingLayout) {
            return old;
          }
          const newUnsavedLayouts = { ...old };
          delete newUnsavedLayouts[selectedLayout.id];
          return Object.keys(newUnsavedLayouts).length === 0
            ? EMPTY_UNSAVED_LAYOUTS
            : newUnsavedLayouts;
        });
        return;
      }
    }
  }, [selectedLayout]);

  useEffect(() => {
    if (unsavedLayouts !== EMPTY_UNSAVED_LAYOUTS) {
      return;
    }
    if (retryTimerRef.current != undefined) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
    retryDelayMsRef.current = SAVE_INTERVAL_MS;
  }, [unsavedLayouts]);

  const [debouncedUnsavedLayouts, debouncedUnsavedLayoutActions] = useDebounce(
    unsavedLayouts,
    SAVE_INTERVAL_MS,
  );

  // Do not leave an edit only in this component after the user switches layouts. Starting the
  // update now lets subsequent actions on the previous layout observe its edit revision.
  useEffect(() => {
    const previousId = previousSelectedLayoutIdRef.current;
    previousSelectedLayoutIdRef.current = selectedLayout?.id;
    if (
      previousId != undefined &&
      previousId !== selectedLayout?.id &&
      unsavedLayoutsRef.current[previousId] != undefined
    ) {
      debouncedUnsavedLayoutActions.flush();
    }
  }, [debouncedUnsavedLayoutActions, selectedLayout?.id]);

  // Flush and clear pending updates on unmount.
  useEffect(() => {
    return () => {
      debouncedUnsavedLayoutActions.flush();
      debouncedUnsavedLayoutActions.cancel();
      if (retryTimerRef.current != undefined) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [debouncedUnsavedLayoutActions]);

  // Write all pending layout updates to the layout manager. Under the hood this
  // uses useEffect so it happens after DOM updates are complete.
  useAsync(async () => {
    void retryToken;
    const unsavedLayoutsSnapshot = { ...debouncedUnsavedLayouts };
    const successIds: LayoutID[] = [];
    let hadFailure = false;

    for (const params of Object.values(unsavedLayoutsSnapshot)) {
      try {
        if (unsavedLayoutsRef.current[params.id] !== params) {
          continue;
        }
        await layoutManager.updateLayout({
          id: params.id,
          data: params.data,
          editRevision: params.editRevision,
        });
        successIds.push(params.id);
      } catch (error) {
        if (unsavedLayoutsRef.current[params.id] !== params) {
          continue;
        }
        hadFailure = true;
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

    if (hadFailure) {
      scheduleRetry();
    }

    if (successIds.length > 0) {
      void analytics.logEvent(AppEvent.LAYOUT_UPDATE);
    }
  }, [analytics, debouncedUnsavedLayouts, isMounted, layoutManager, retryToken, scheduleRetry]);

  return ReactNull;
}
