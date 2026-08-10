// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { useRecommendedLayouts } from "@foxglove/studio-base/context/RecommendedLayoutContext";
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
import { isLayoutEqual } from "@foxglove/studio-base/services/LayoutManager/compareLayouts";
import type { RecommendedLayoutDescriptor } from "@foxglove/studio-base/services/RecommendedLayouts";
import { downloadTextFile } from "@foxglove/studio-base/util/download";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";
import { CurrentLayoutButton } from "./CurrentLayoutButton";
import { useCurrentLayout } from "./hooks/useCurrentLayout";

const log = Logger.getLogger(__filename);

const layoutDrawerOpen = (store: WorkspaceContextStore) => store.layoutDrawer.open;
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
const selectedLayoutSelector = (state: LayoutState) => state.selectedLayout;

function getCurrentLayoutParams(state: LayoutState, id: LayoutID) {
  const selectedLayout = state.selectedLayout;
  if (selectedLayout?.id !== id || selectedLayout.edited !== true) {
    return { id };
  }
  return {
    id,
    ...(selectedLayout.data != undefined ? { data: selectedLayout.data } : {}),
    ...(selectedLayout.editRevision != undefined
      ? { editRevision: selectedLayout.editRevision }
      : {}),
  };
}

function getLatestLayoutData(state: LayoutState, layout: Layout): LayoutData {
  const selectedLayout = state.selectedLayout;
  return selectedLayout?.id === layout.id &&
    selectedLayout.edited === true &&
    selectedLayout.data != undefined
    ? selectedLayout.data
    : (layout.working?.data ?? layout.baseline.data);
}

function getCurrentEditRevision(state: LayoutState, id: LayoutID): number | undefined {
  return state.selectedLayout?.id === id && state.selectedLayout.edited === true
    ? state.selectedLayout.editRevision
    : undefined;
}

export function CoSceneLayoutButton(): React.JSX.Element {
  const open = useWorkspaceStore(layoutDrawerOpen);
  const { layoutDrawer } = useWorkspaceActions();

  const consoleApi = useConsoleApi();

  const layouts = useCurrentLayout();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const selectedLayout = useCurrentLayoutSelector(selectedLayoutSelector);
  const recommendedLayouts = useRecommendedLayouts();
  const recommendedLayoutsRef = useRef(recommendedLayouts);
  recommendedLayoutsRef.current = recommendedLayouts;

  const { enqueueSnackbar } = useSnackbar();
  const analytics = useAnalytics();
  const { t } = useTranslation("layout");
  const confirm = useConfirm();
  const layoutSelectionGeneration = useRef(0);

  const layoutManager = useLayoutManager();
  const {
    getCurrentLayoutState,
    saveRecommendedLayout,
    setCurrentLayout,
    setSelectedLayoutId,
    withRecommendedLayoutCopyLock,
  } = useCurrentLayoutActions();

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
              await layoutManager.revertLayout({
                id: id as LayoutID,
                editRevision: getCurrentEditRevision(getCurrentLayoutState(), id as LayoutID),
              });
              dispatch({ type: "shift-multi-action" });
              break;
            case "save":
              await layoutManager.overwriteLayout(
                getCurrentLayoutParams(getCurrentLayoutState(), id as LayoutID),
              );
              dispatch({ type: "shift-multi-action" });
              break;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          enqueueSnackbar(`Error processing layouts: ${message}`, { variant: "error" });
          dispatch({ type: "clear-multi-action" });
        }
      }
    };

    processAction().catch((err: unknown) => {
      log.error(err);
    });
  }, [dispatch, enqueueSnackbar, getCurrentLayoutState, layoutManager, state.multiAction]);

  const confirmDiscardRecommendedChanges = useCallback(async (): Promise<boolean> => {
    const currentLayout = getCurrentLayoutState().selectedLayout;
    if (currentLayout?.source !== "recommended" || currentLayout.edited !== true) {
      return true;
    }
    const response = await confirm({
      variant: "danger",
      title: t("discardRecommendedChangesTitle"),
      prompt: t("discardRecommendedChangesPrompt"),
      ok: t("discardChanges"),
      cancel: t("cancel", { ns: "general" }),
    });
    return response === "ok";
  }, [confirm, getCurrentLayoutState, t]);

  const onSelectLayout = useCallbackWithToast(
    async (item: Layout) => {
      const selectionGeneration = ++layoutSelectionGeneration.current;
      if (!(await confirmDiscardRecommendedChanges())) {
        return;
      }
      if (selectionGeneration !== layoutSelectionGeneration.current) {
        return;
      }
      void analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: item.permission });
      setSelectedLayoutId(item.id);
      dispatch({ type: "select-id", id: item.id });
      layoutDrawer.close();
    },
    [analytics, confirmDiscardRecommendedChanges, dispatch, setSelectedLayoutId, layoutDrawer],
  );

  const onSelectRecommendedLayout = useCallbackWithToast(
    async (descriptor: RecommendedLayoutDescriptor) => {
      const selectionGeneration = ++layoutSelectionGeneration.current;
      if (!(await confirmDiscardRecommendedChanges())) {
        return;
      }
      if (selectionGeneration !== layoutSelectionGeneration.current) {
        return;
      }
      const selectedLayoutBeforeLoad = getCurrentLayoutState().selectedLayout;
      const data = await recommendedLayouts.loadLayout(descriptor);
      if (selectionGeneration !== layoutSelectionGeneration.current) {
        return;
      }
      if (
        !recommendedLayoutsRef.current.layouts.some(
          (layout) => layout.id === descriptor.id && layout.url === descriptor.url,
        )
      ) {
        return;
      }
      if (getCurrentLayoutState().selectedLayout !== selectedLayoutBeforeLoad) {
        return;
      }
      setCurrentLayout({
        id: descriptor.id,
        name: descriptor.name,
        data,
        source: "recommended",
        recommendedLayout: descriptor,
      });
      void analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: "RECOMMENDED" });
      dispatch({ type: "select-id", id: descriptor.id });
      layoutDrawer.close();
    },
    [
      analytics,
      confirmDiscardRecommendedChanges,
      dispatch,
      getCurrentLayoutState,
      layoutDrawer,
      recommendedLayouts,
      setCurrentLayout,
    ],
  );

  const onCopyRecommendedLayout = useCallbackWithToast(
    async (descriptor: RecommendedLayoutDescriptor) => {
      await withRecommendedLayoutCopyLock(async () => {
        const selectionGeneration = ++layoutSelectionGeneration.current;
        const currentLayoutBeforeConfirm = getCurrentLayoutState().selectedLayout;
        const wasActiveRecommendation =
          currentLayoutBeforeConfirm?.source === "recommended" &&
          currentLayoutBeforeConfirm.id === descriptor.id;
        if (!wasActiveRecommendation && !(await confirmDiscardRecommendedChanges())) {
          return;
        }
        if (selectionGeneration !== layoutSelectionGeneration.current) {
          return;
        }

        const response = await confirm({
          title: t("recommendedLayoutReadOnlyTitle"),
          prompt: t("recommendedLayoutReadOnlyPrompt"),
          ok: t("saveAPersonalCopy"),
          cancel: t("cancel", { ns: "general" }),
        });
        if (response !== "ok") {
          return;
        }
        if (selectionGeneration !== layoutSelectionGeneration.current) {
          return;
        }

        const selectedLayoutBeforeCopy = getCurrentLayoutState().selectedLayout;
        const isActiveRecommendation =
          selectedLayoutBeforeCopy?.source === "recommended" &&
          selectedLayoutBeforeCopy.id === descriptor.id;
        if (isActiveRecommendation !== wasActiveRecommendation) {
          return;
        }
        try {
          const data = isActiveRecommendation
            ? selectedLayoutBeforeCopy.data
            : await recommendedLayouts.loadLayout(descriptor);
          if (!data || selectionGeneration !== layoutSelectionGeneration.current) {
            return;
          }
          if (
            !isActiveRecommendation &&
            !recommendedLayoutsRef.current.layouts.some(
              (layout) => layout.id === descriptor.id && layout.url === descriptor.url,
            )
          ) {
            return;
          }
          if (
            !isActiveRecommendation &&
            getCurrentLayoutState().selectedLayout !== selectedLayoutBeforeCopy
          ) {
            return;
          }

          const newLayout = await layoutManager.saveNewLayout({
            folder: "",
            name: `${descriptor.name} copy`,
            data,
            permission: "PERSONAL_WRITE",
          });
          void analytics.logEvent(AppEvent.LAYOUT_CREATE);
          if (selectionGeneration !== layoutSelectionGeneration.current) {
            return;
          }

          const latestLayout = getCurrentLayoutState().selectedLayout;
          if (isActiveRecommendation) {
            if (
              latestLayout?.source !== "recommended" ||
              latestLayout.id !== descriptor.id ||
              latestLayout.data == undefined
            ) {
              return;
            }
            const editedSinceSave = !isLayoutEqual(data, latestLayout.data);
            setCurrentLayout({
              id: newLayout.id,
              name: newLayout.name,
              data: latestLayout.data,
              source: "stored",
              ...(editedSinceSave ? { edited: true, editRevision: latestLayout.editRevision } : {}),
            });
            void layoutManager.putHistory({ id: newLayout.id });
          } else {
            if (latestLayout !== selectedLayoutBeforeCopy) {
              return;
            }
            setSelectedLayoutId(newLayout.id);
          }
          enqueueSnackbar(t("copyLayoutSuccess"), { variant: "success" });
          layoutDrawer.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          enqueueSnackbar(t("recommendedLayoutCopyFailed", { message }), { variant: "error" });
        }
      });
    },
    [
      analytics,
      confirm,
      confirmDiscardRecommendedChanges,
      enqueueSnackbar,
      getCurrentLayoutState,
      layoutDrawer,
      layoutManager,
      recommendedLayouts,
      setCurrentLayout,
      setSelectedLayoutId,
      t,
      withRecommendedLayoutCopyLock,
    ],
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
      const content =
        JSON.stringify(getLatestLayoutData(getCurrentLayoutState(), item), undefined, 2) ?? "";
      downloadTextFile(content, `${item.name}.json`);
      void analytics.logEvent(AppEvent.LAYOUT_EXPORT, { permission: item.permission });
    },
    [analytics, getCurrentLayoutState],
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
            ns: "general",
          }),
          cancel: t("cancel", {
            ns: "general",
          }),
        });
        if (response !== "ok") {
          return;
        }
      }
      await layoutManager.overwriteLayout(getCurrentLayoutParams(getCurrentLayoutState(), item.id));
      void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, { permission: item.permission });
    },
    [
      analytics,
      confirm,
      dispatch,
      getCurrentLayoutState,
      layoutManager,
      state.selectedIds.length,
      t,
    ],
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
          ns: "general",
        }),
      });
      if (response !== "ok") {
        return;
      }

      await layoutManager.revertLayout({
        id: item.id,
        editRevision: getCurrentEditRevision(getCurrentLayoutState(), item.id),
      });
      void analytics.logEvent(AppEvent.LAYOUT_REVERT, { permission: item.permission });
    },
    [
      analytics,
      confirm,
      dispatch,
      getCurrentLayoutState,
      layoutManager,
      state.selectedIds.length,
      t,
    ],
  );

  const onCreateLayout = useCallbackWithToast(
    async (params: CreateLayoutParams) => {
      const selectionGeneration = ++layoutSelectionGeneration.current;
      if (!(await confirmDiscardRecommendedChanges())) {
        return;
      }
      if (selectionGeneration !== layoutSelectionGeneration.current) {
        return;
      }
      const selectedLayoutBeforeCreate = getCurrentLayoutState().selectedLayout;
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
      void analytics.logEvent(AppEvent.LAYOUT_CREATE);
      if (
        selectionGeneration !== layoutSelectionGeneration.current ||
        getCurrentLayoutState().selectedLayout !== selectedLayoutBeforeCreate
      ) {
        return;
      }
      setSelectedLayoutId(newLayout.id);
      dispatch({ type: "select-id", id: newLayout.id });
      layoutDrawer.close();
    },
    [
      analytics,
      confirmDiscardRecommendedChanges,
      dispatch,
      getCurrentLayoutState,
      layoutDrawer,
      layoutManager,
      setSelectedLayoutId,
    ],
  );

  return (
    <>
      <CurrentLayoutButton
        currentLayoutId={currentLayoutId}
        layouts={layouts.value}
        loading={layouts.loading}
        selectedLayout={selectedLayout}
        onSaveRecommendedLayout={saveRecommendedLayout}
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
          recommendedLayouts={recommendedLayouts.layouts}
          onSelectLayout={onSelectLayout}
          onSelectRecommendedLayout={onSelectRecommendedLayout}
          onCopyRecommendedLayout={onCopyRecommendedLayout}
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
