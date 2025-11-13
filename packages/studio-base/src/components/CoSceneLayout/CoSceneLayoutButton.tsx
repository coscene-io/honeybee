// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

import Logger from "@foxglove/log";
import { useLayoutBrowserReducer } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
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
import { Layout, layoutIsProject } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { downloadTextFile } from "@foxglove/studio-base/util/download";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";
import { CurrentLayoutButton } from "./CurrentLayoutButton";
import { useCurrentLayout } from "./hooks/useCurrentLayout";

const log = Logger.getLogger(__filename);

const layoutDrawerOpen = (store: WorkspaceContextStore) => store.layoutDrawer.open;
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

export function CoSceneLayoutButton(): React.JSX.Element {
  const open = useWorkspaceStore(layoutDrawerOpen);
  const { layoutDrawer } = useWorkspaceActions();

  const consoleApi = useConsoleApi();

  const layouts = useCurrentLayout();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);

  const { enqueueSnackbar } = useSnackbar();
  const analytics = useAnalytics();
  const { t } = useTranslation("cosLayout");
  const confirm = useConfirm();

  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();

  const [state, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy,
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

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

  const onSelectLayout = useCallbackWithToast(
    async (item: Layout) => {
      void analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: item.permission });
      setSelectedLayoutId(item.id);
      dispatch({ type: "select-id", id: item.id });
      layoutDrawer.close();
    },
    [analytics, dispatch, setSelectedLayoutId, layoutDrawer],
  );

  const onRenameLayout = useCallbackWithToast(
    async (item: Layout, newName: string) => {
      await layoutManager.updateLayout({ id: item.id, name: newName });
      void analytics.logEvent(AppEvent.LAYOUT_RENAME, { permission: item.permission });
    },
    [analytics, layoutManager],
  );

  const onMoveLayout = useCallbackWithToast(
    async (item: Layout, newFolder: string) => {
      await layoutManager.updateLayout({ id: item.id, folder: newFolder });
      void analytics.logEvent(AppEvent.LAYOUT_MOVE, { permission: item.permission });
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

      if (layoutIsProject(item)) {
        const response = await confirm({
          title: `${t("update")} "${item.name}"?`,
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

      const response = await confirm({
        variant: "danger",
        title: `${t("revert")} "${item.name}"?`,
        prompt: t("revertLayoutConfirm"),
        ok: t("discardChanges"),
        cancel: t("cancel", {
          ns: "cosGeneral",
        }),
      });
      if (response !== "ok") {
        return;
      }

      await layoutManager.revertLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_REVERT, { permission: item.permission });
    },
    [analytics, confirm, dispatch, layoutManager, state.selectedIds.length, t],
  );

  const onCreateLayout = useCallbackWithToast(
    async (params: CreateLayoutParams) => {
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
    [layoutManager, onSelectLayout, analytics],
  );

  return (
    <>
      <CurrentLayoutButton
        currentLayoutId={currentLayoutId}
        layouts={layouts.value}
        loading={layouts.loading}
        onOverwriteLayout={onOverwriteLayout}
        onRevertLayout={onRevertLayout}
        onClick={layoutDrawer.open}
      />
      {open && (
        <CoSceneLayoutDrawer
          currentLayoutId={currentLayoutId}
          supportsProjectWrite={consoleApi.createProjectLayout.permission()}
          open
          layouts={layouts.value}
          onSelectLayout={onSelectLayout}
          onDeleteLayout={onDeleteLayout}
          onRenameLayout={onRenameLayout}
          onMoveLayout={onMoveLayout}
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
