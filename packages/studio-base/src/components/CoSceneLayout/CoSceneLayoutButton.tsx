// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useState } from "react";

import { useUnsavedChangesPrompt } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/CoSceneUnsavedChangesPrompt";
import { useLayoutBrowserReducer } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useCurrentLayoutActions } from "@foxglove/studio-base/context/CurrentLayoutContext";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";
import { LayoutButton } from "./components/LayoutButton";
import { useCurrentLayout } from "./hooks/useCurrentLayout";

export function CoSceneLayoutButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { currentLayoutId, currentLayout, layouts } = useCurrentLayout();

  const analytics = useAnalytics();
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const { unsavedChangesPrompt, openUnsavedChangesPrompt } = useUnsavedChangesPrompt();

  const [state, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy,
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

  /**
   * Don't allow the user to switch away from a personal layout if they have unsaved changes. This
   * currently has a race condition because of the throttled save in CurrentLayoutProvider -- it's
   * possible to make changes and switch layouts before they're sent to the layout manager.
   * @returns true if the original action should continue, false otherwise
   */
  const promptForUnsavedChanges = useCallback(async () => {
    const currentLayout =
      currentLayoutId != undefined
        ? await layoutManager.getLayout({ id: currentLayoutId })
        : undefined;
    if (
      currentLayout != undefined &&
      layoutIsShared(currentLayout) &&
      currentLayout.working != undefined
    ) {
      const result = await openUnsavedChangesPrompt(currentLayout);
      switch (result.type) {
        case "cancel":
          return false;
        case "discard":
          await layoutManager.revertLayout({ id: currentLayout.id });
          void analytics.logEvent(AppEvent.LAYOUT_REVERT, {
            permission: currentLayout.permission,
            context: "UnsavedChangesPrompt",
          });
          return true;
        case "overwrite":
          await layoutManager.overwriteLayout({ id: currentLayout.id });
          void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, {
            permission: currentLayout.permission,
            context: "UnsavedChangesPrompt",
          });
          return true;
        case "makePersonal":
          // We don't use onMakePersonalCopy() here because it might need to prompt for unsaved changes, and we don't want to select the newly created layout
          await layoutManager.makePersonalCopy({
            id: currentLayout.id,
            displayName: result.displayName,
          });
          void analytics.logEvent(AppEvent.LAYOUT_MAKE_PERSONAL_COPY, {
            permission: currentLayout.permission,
            syncStatus: currentLayout.syncInfo?.status,
            context: "UnsavedChangesPrompt",
          });
          return true;
      }
    }
    return true;
  }, [analytics, currentLayoutId, layoutManager, openUnsavedChangesPrompt]);

  const onSelectLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (!(await promptForUnsavedChanges())) {
        return;
      }
      void analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: item.permission });
      setSelectedLayoutId(item.id);
      dispatch({ type: "select-id", id: item.id });
      setOpen(false);
    },
    [analytics, dispatch, promptForUnsavedChanges, setSelectedLayoutId],
  );

  const onDeleteLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "delete" });
        return;
      }

      void analytics.logEvent(AppEvent.LAYOUT_DELETE, { permission: item.permission });

      // If the layout was selected, select a different available layout.
      //
      // When a users current layout is deleted, we display a notice. By selecting a new layout
      // before deleting their current layout we avoid the weirdness of displaying a notice that the
      // user just deleted their current layout which is somewhat obvious to the user.
      if (currentLayoutId === item.id) {
        const storedLayouts = await layoutManager.getLayouts();
        const targetLayout = storedLayouts.find((layout) => layout.id !== currentLayoutId);
        setSelectedLayoutId(targetLayout?.id);
        dispatch({ type: "select-id", id: targetLayout?.id });
      }
      await layoutManager.deleteLayout({ id: item.id });
    },
    [
      analytics,
      currentLayoutId,
      dispatch,
      layoutManager,
      setSelectedLayoutId,
      state.selectedIds.length,
    ],
  );

  // todo: 实现
  // const onRenameLayout = () => {};
  // const onRevertLayout = () => {};
  // const onCreateNewLayout = () => {};

  return (
    <>
      <LayoutButton
        currentLayout={currentLayout}
        loading={layouts.loading}
        onClick={() => {
          setOpen(true);
        }}
      />
      {unsavedChangesPrompt}
      {open && (
        <CoSceneLayoutDrawer
          open
          layouts={layouts.value}
          onSelectLayout={onSelectLayout}
          onDeleteLayout={onDeleteLayout}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
