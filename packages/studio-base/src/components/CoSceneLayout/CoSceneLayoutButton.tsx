// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useCallback, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

import Logger from "@foxglove/log";
import { useUnsavedChangesPrompt } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/CoSceneUnsavedChangesPrompt";
import { useLayoutBrowserReducer } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  useCurrentLayoutActions,
  LayoutID,
  useCurrentLayoutSelector,
  LayoutState,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  useWorkspaceStore,
  WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { downloadTextFile } from "@foxglove/studio-base/util/download";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";
import { LayoutButton } from "./components/LayoutButton";
import { useCurrentLayout } from "./hooks/useCurrentLayout";

const log = Logger.getLogger(__filename);

const layoutDrawerOpen = (store: WorkspaceContextStore) => store.layoutDrawer.open;
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

export function CoSceneLayoutButton(): React.JSX.Element {
  const open = useWorkspaceStore(layoutDrawerOpen);
  const { layoutDrawer } = useWorkspaceActions();

  const layouts = useCurrentLayout();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);

  const { enqueueSnackbar } = useSnackbar();
  const analytics = useAnalytics();
  const { t } = useTranslation("cosLayout");
  const confirm = useConfirm();

  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const { unsavedChangesPrompt, openUnsavedChangesPrompt } = useUnsavedChangesPrompt();

  const [state, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy,
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

  // const pendingMultiAction = state.multiAction?.ids != undefined;

  // const anySelectedModifiedLayouts = useMemo(() => {
  //   return [layouts.value?.personalLayouts ?? [], layouts.value?.projectLayouts ?? []]
  //     .flat()
  //     .some((layout) => layout.working != undefined && state.selectedIds.includes(layout.id));
  // }, [layouts, state.selectedIds]);

  useLayoutEffect(() => {
    const busyListener = () => {
      dispatch({ type: "set-busy", value: layoutManager.isBusy });
    };
    const onlineListener = () => {
      dispatch({ type: "set-online", value: layoutManager.isOnline });
    };
    const errorListener = () => {
      dispatch({ type: "set-error", value: layoutManager.error });
    };
    busyListener();
    onlineListener();
    errorListener();
    layoutManager.on("busychange", busyListener);
    layoutManager.on("onlinechange", onlineListener);
    layoutManager.on("errorchange", errorListener);
    return () => {
      layoutManager.off("busychange", busyListener);
      layoutManager.off("onlinechange", onlineListener);
      layoutManager.off("errorchange", errorListener);
    };
  }, [dispatch, layoutManager]);

  useEffect(() => {
    const processAction = async () => {
      if (!state.multiAction) {
        return;
      }

      const id = state.multiAction.ids[0];
      if (id) {
        try {
          switch (state.multiAction.action) {
            case "delete":
              await layoutManager.deleteLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
            case "duplicate": {
              const layout = await layoutManager.getLayout({ id: id as LayoutID });
              if (layout) {
                await layoutManager.saveNewLayout({
                  folder: layout.folder,
                  name: `${layout.name} copy`,
                  data: layout.working?.data ?? layout.baseline.data,
                  permission: "PERSONAL_WRITE",
                });
              }
              dispatch({ type: "shift-multi-action" });
              break;
            }
            case "revert":
              await layoutManager.revertLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
            case "save":
              await layoutManager.overwriteLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
          }
        } catch (err) {
          enqueueSnackbar(`Error processing layouts: ${err.message}`, { variant: "error" });
          dispatch({ type: "clear-multi-action" });
        }
      }
    };

    processAction().catch((err: unknown) => {
      log.error(err);
    });
  }, [dispatch, enqueueSnackbar, layoutManager, state.multiAction]);

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
            name: result.name,
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
      layoutDrawer.close();
    },
    [analytics, dispatch, promptForUnsavedChanges, setSelectedLayoutId, layoutDrawer],
  );

  const onRenameLayout = useCallbackWithToast(
    async (item: Layout, newName: string) => {
      await layoutManager.updateLayout({ id: item.id, name: newName });
      void analytics.logEvent(AppEvent.LAYOUT_RENAME, { permission: item.permission });
    },
    [analytics, layoutManager],
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

  const onExportLayout = useCallbackWithToast(
    async (item: Layout) => {
      const content = JSON.stringify(item.working?.data ?? item.baseline.data, undefined, 2) ?? "";
      downloadTextFile(content, `${item.name}.json`);
      void analytics.logEvent(AppEvent.LAYOUT_EXPORT, { permission: item.permission });
    },
    [analytics],
  );

  const onOverwriteLayout = useCallbackWithToast(
    async (item: Layout) => {
      // We don't need to confirm the multiple selection case because we force users to save
      // or abandon changes before selecting another layout with unsaved changes to the current
      // shared layout.
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "save" });
        return;
      }

      if (layoutIsShared(item)) {
        const response = await confirm({
          title: `${t("update")} " ${item.name}"?`,
          prompt: t("updateRemoteLayoutConfirm"),
          ok: t("save", {
            ns: "cosGeneral",
          }),
          cancel: t("cancel", {
            ns: "cosGeneral",
          }),
        });
        if (response !== "ok") {
          return;
        }
      }
      await layoutManager.overwriteLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, { permission: item.permission });
    },
    [analytics, confirm, dispatch, layoutManager, state.selectedIds.length, t],
  );

  const onRevertLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "revert" });
        return;
      }

      await layoutManager.revertLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_REVERT, { permission: item.permission });
    },
    [analytics, dispatch, layoutManager, state.selectedIds.length],
  );

  const onCreateLayout = useCallbackWithToast(
    async (params: CreateLayoutParams) => {
      if (!(await promptForUnsavedChanges())) {
        return;
      }

      const data = params.data ?? {
        configById: {},
        globalVariables: {},
        userNodes: {},
      };

      const newLayout = await layoutManager.saveNewLayout({
        folder: params.folder,
        name: params.name,
        data,
        permission: params.permission,
      });
      void onSelectLayout(newLayout);

      void analytics.logEvent(AppEvent.LAYOUT_CREATE);
    },
    [promptForUnsavedChanges, layoutManager, onSelectLayout, analytics],
  );

  return (
    <>
      <LayoutButton
        currentLayoutId={currentLayoutId}
        layouts={layouts.value}
        supportsEditProject={layoutManager.supportsEditProject}
        loading={layouts.loading}
        onOverwriteLayout={onOverwriteLayout}
        onRevertLayout={onRevertLayout}
        onClick={layoutDrawer.open}
      />
      {unsavedChangesPrompt}
      {open && (
        <CoSceneLayoutDrawer
          currentLayoutId={currentLayoutId}
          supportsEditProject={layoutManager.supportsEditProject}
          open
          layouts={layouts.value}
          onSelectLayout={onSelectLayout}
          onDeleteLayout={onDeleteLayout}
          onRenameLayout={onRenameLayout}
          onExportLayout={onExportLayout}
          onOverwriteLayout={onOverwriteLayout}
          onRevertLayout={onRevertLayout}
          onCreateLayout={onCreateLayout}
          onClose={layoutDrawer.close}
        />
      )}
    </>
  );
}
