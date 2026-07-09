// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { enqueueSnackbar } from "notistack";
import { useEffect, useRef, useState } from "react";
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

type UpdatedLayout = NonNullable<LayoutState["selectedLayout"]>;

const log = Logger.getLogger(__filename);

const EMPTY_UNSAVED_LAYOUTS: Record<LayoutID, UpdatedLayout> = {};
const SAVE_INTERVAL_MS = 1000;

const selectCurrentLayout = (state: LayoutState) => state.selectedLayout;

/**
 * Observes changes in the current layout and asynchronously pushes them to the
 * layout manager.
 */
export function CurrentLayoutSyncAdapter(): ReactNull {
  const selectedLayout = useCurrentLayoutSelector(selectCurrentLayout);

  const layoutManager = useLayoutManager();

  const [unsavedLayouts, setUnsavedLayouts] = useState(EMPTY_UNSAVED_LAYOUTS);
  const unsavedLayoutsRef = useRef(unsavedLayouts);
  useEffect(() => {
    unsavedLayoutsRef.current = unsavedLayouts;
  }, [unsavedLayouts]);

  const analytics = useAnalytics();

  const isMounted = useMountedState();

  useEffect(() => {
    if (selectedLayout?.edited === true && selectedLayout.transient !== true) {
      setUnsavedLayouts((old) => ({
        ...old,
        [selectedLayout.id]: selectedLayout,
      }));
    } else if (selectedLayout?.id != undefined) {
      setUnsavedLayouts((old) => {
        const pendingLayout = old[selectedLayout.id];
        if (
          pendingLayout == undefined ||
          selectedLayout.data == undefined ||
          !_.isEqual(selectedLayout.data, pendingLayout.data)
        ) {
          return old;
        }
        const newUnsavedLayouts = { ...old };
        delete newUnsavedLayouts[selectedLayout.id];
        return Object.keys(newUnsavedLayouts).length === 0
          ? EMPTY_UNSAVED_LAYOUTS
          : newUnsavedLayouts;
      });
    }
  }, [selectedLayout]);

  const [debouncedUnsavedLayouts, debouncedUnsavedLayoutActions] = useDebounce(
    unsavedLayouts,
    SAVE_INTERVAL_MS,
  );

  // Flush and clear pending updates on unmount.
  useEffect(() => {
    return () => {
      debouncedUnsavedLayoutActions.flush();
      debouncedUnsavedLayoutActions.cancel();
    };
  }, [debouncedUnsavedLayoutActions]);

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
        await layoutManager.updateLayout({ id: params.id, data: params.data });
        successIds.push(params.id);
      } catch (error) {
        failedLayouts.push(params);
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

    if (successIds.length > 0 || failedLayouts.length > 0) {
      setUnsavedLayouts((old) => {
        const newUnsavedLayouts = { ...old };
        for (const id of successIds) {
          if (newUnsavedLayouts[id] === unsavedLayoutsSnapshot[id]) {
            delete newUnsavedLayouts[id];
          }
        }
        for (const layout of failedLayouts) {
          if (newUnsavedLayouts[layout.id] === layout) {
            newUnsavedLayouts[layout.id] = layout;
          }
        }
        return Object.keys(newUnsavedLayouts).length === 0
          ? EMPTY_UNSAVED_LAYOUTS
          : newUnsavedLayouts;
      });
    }

    if (successIds.length > 0) {
      void analytics.logEvent(AppEvent.LAYOUT_UPDATE);
    }
  }, [analytics, debouncedUnsavedLayouts, isMounted, layoutManager]);

  return ReactNull;
}
