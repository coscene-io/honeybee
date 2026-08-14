// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNodeAtPath } from "react-mosaic-component";
import { useAsyncFn, useMountedState } from "react-use";
import shallowequal from "shallowequal";
import { v4 as uuidv4 } from "uuid";

import { useShallowMemo } from "@foxglove/hooks";
import Logger from "@foxglove/log";
import { VariableValue } from "@foxglove/studio";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import CurrentLayoutContext, {
  ICurrentLayout,
  LayoutID,
  LayoutState,
  MAX_SUPPORTED_LAYOUT_VERSION,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  AddPanelPayload,
  ChangePanelLayoutPayload,
  ClosePanelPayload,
  CreateTabPanelPayload,
  DropPanelPayload,
  EndDragPayload,
  MoveTabPayload,
  PanelsActions,
  SaveConfigsPayload,
  SplitPanelPayload,
  StartDragPayload,
  SwapPanelPayload,
} from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import panelsReducer from "@foxglove/studio-base/providers/CurrentLayoutProvider/reducers";
import { LayoutManagerEventTypes } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { isLayoutEqual } from "@foxglove/studio-base/services/LayoutManager/compareLayouts";
import { PanelConfig, UserScripts } from "@foxglove/studio-base/types/panels";
import { getPanelTypeFromId } from "@foxglove/studio-base/util/layout";

import { IncompatibleLayoutVersionAlert } from "./IncompatibleLayoutVersionAlert";

const log = Logger.getLogger(__filename);

export { MAX_SUPPORTED_LAYOUT_VERSION } from "@foxglove/studio-base/context/CurrentLayoutContext";
let nextEditRevision = 0;

/**
 * Concrete implementation of CurrentLayoutContext.Provider which handles
 * automatically restoring the current layout from LayoutStorage.
 */
export default function CurrentLayoutProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const { enqueueSnackbar } = useSnackbar();
  const layoutManager = useLayoutManager();
  const analytics = useAnalytics();
  const isMounted = useMountedState();
  const confirm = useConfirm();
  const { t } = useTranslation("layout");

  const [mosaicId] = useState(() => uuidv4());

  const layoutStateListeners = useRef(new Set<(_: LayoutState) => void>());
  const addLayoutStateListener = useCallback((listener: (_: LayoutState) => void) => {
    layoutStateListeners.current.add(listener);
  }, []);
  const removeLayoutStateListener = useCallback((listener: (_: LayoutState) => void) => {
    layoutStateListeners.current.delete(listener);
  }, []);

  const [layoutState, setLayoutStateInternal] = useState<LayoutState>({
    selectedLayout: undefined,
  });
  const layoutStateRef = useRef(layoutState);
  const layoutSelectionGenerationRef = useRef(0);
  const recommendedCopyInProgressRef = useRef(false);
  const [incompatibleLayoutVersionError, setIncompatibleLayoutVersionError] = useState(false);
  const setLayoutState = useCallback((newState: LayoutState) => {
    setLayoutStateInternal(newState);

    // listeners rely on being able to getCurrentLayoutState() inside effects that may run before we re-render
    layoutStateRef.current = newState;

    for (const listener of [...layoutStateListeners.current]) {
      listener(newState);
    }
  }, []);

  const selectedPanelIds = useRef<readonly string[]>([]);
  const selectedPanelIdsListeners = useRef(new Set<(_: readonly string[]) => void>());
  const addSelectedPanelIdsListener = useCallback((listener: (_: readonly string[]) => void) => {
    selectedPanelIdsListeners.current.add(listener);
  }, []);
  const removeSelectedPanelIdsListener = useCallback((listener: (_: readonly string[]) => void) => {
    selectedPanelIdsListeners.current.delete(listener);
  }, []);

  const getSelectedPanelIds = useCallback(() => selectedPanelIds.current, []);
  const setSelectedPanelIds = useCallback(
    (value: readonly string[] | ((prevState: readonly string[]) => readonly string[])): void => {
      const newValue = typeof value === "function" ? value(selectedPanelIds.current) : value;
      if (!shallowequal(newValue, selectedPanelIds.current)) {
        selectedPanelIds.current = newValue;
        for (const listener of [...selectedPanelIdsListeners.current]) {
          listener(selectedPanelIds.current);
        }
      }
    },
    [],
  );

  const [, setSelectedLayoutId] = useAsyncFn(
    async (
      id: LayoutID | undefined,
      { saveToProfile = true }: { saveToProfile?: boolean } = {},
    ) => {
      const selectionGeneration = ++layoutSelectionGenerationRef.current;
      if (id == undefined) {
        setLayoutState({ selectedLayout: undefined });
        return;
      }
      try {
        setLayoutState({
          selectedLayout: { id, loading: true, data: undefined, source: "stored" },
        });
        const layout = await layoutManager.getLayout({ id });
        if (!isMounted() || selectionGeneration !== layoutSelectionGenerationRef.current) {
          return;
        }
        const layoutVersion = layout?.baseline.data.version;
        if (layoutVersion != undefined && layoutVersion > MAX_SUPPORTED_LAYOUT_VERSION) {
          setIncompatibleLayoutVersionError(true);
          setLayoutState({ selectedLayout: undefined });
          return;
        }
        setIncompatibleLayoutVersionError(false);
        if (layout == undefined) {
          setLayoutState({ selectedLayout: undefined });
        } else {
          setLayoutState({
            selectedLayout: {
              loading: false,
              id: layout.id,
              data: layout.working?.data ?? layout.baseline.data,
              name: layout.name,
              source: "stored",
            },
          });
          if (saveToProfile) {
            void layoutManager.putHistory({ id });
          }
        }
      } catch (error) {
        if (!isMounted() || selectionGeneration !== layoutSelectionGenerationRef.current) {
          return;
        }
        console.error(error);
        const message = error instanceof Error ? error.toString() : String(error);
        enqueueSnackbar(`The layout could not be loaded. ${message}`, {
          variant: "error",
        });
        setIncompatibleLayoutVersionError(false);
        setLayoutState({ selectedLayout: undefined });
      }
    },
    [enqueueSnackbar, isMounted, layoutManager, setLayoutState],
  );

  const setCurrentLayout = useCallback<ICurrentLayout["actions"]["setCurrentLayout"]>(
    (newLayout) => {
      layoutSelectionGenerationRef.current++;
      if (newLayout == undefined) {
        setLayoutState({ selectedLayout: undefined });
        return;
      }
      setIncompatibleLayoutVersionError(false);
      const selectedLayout: NonNullable<LayoutState["selectedLayout"]> = {
        loading: false,
        id: newLayout.id ?? (uuidv4() as LayoutID),
        data: newLayout.data,
        name: newLayout.name,
        edited: newLayout.edited,
        editRevision: newLayout.editRevision,
        source: newLayout.source ?? "stored",
        recommendedLayout: newLayout.recommendedLayout,
      };
      if (newLayout.transient === true) {
        selectedLayout.transient = true;
      }
      setLayoutState({
        selectedLayout,
      });
    },
    [setLayoutState],
  );

  const withRecommendedLayoutCopyLock = useCallback<
    ICurrentLayout["actions"]["withRecommendedLayoutCopyLock"]
  >(async (operation) => {
    if (recommendedCopyInProgressRef.current) {
      return undefined;
    }
    recommendedCopyInProgressRef.current = true;
    try {
      return await operation();
    } finally {
      recommendedCopyInProgressRef.current = false;
    }
  }, []);

  const saveRecommendedLayout = useCallback<
    ICurrentLayout["actions"]["saveRecommendedLayout"]
  >(async () => {
    await withRecommendedLayoutCopyLock(async () => {
      const selectedLayout = layoutStateRef.current.selectedLayout;
      if (
        selectedLayout?.source !== "recommended" ||
        selectedLayout.loading === true ||
        selectedLayout.data == undefined
      ) {
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

      const layoutToSave = layoutStateRef.current.selectedLayout;
      if (
        layoutToSave?.source !== "recommended" ||
        layoutToSave.id !== selectedLayout.id ||
        layoutToSave.data == undefined
      ) {
        return;
      }
      const selectionGeneration = layoutSelectionGenerationRef.current;

      try {
        const savedData = layoutToSave.data;
        const newLayout = await layoutManager.saveNewLayout({
          folder: "",
          name: `${layoutToSave.name ?? t("recommendedLayout")} copy`,
          data: savedData,
          permission: "PERSONAL_WRITE",
        });
        if (!isMounted() || selectionGeneration !== layoutSelectionGenerationRef.current) {
          return;
        }

        const latestLayout = layoutStateRef.current.selectedLayout;
        if (
          latestLayout?.source !== "recommended" ||
          latestLayout.id !== layoutToSave.id ||
          latestLayout.data == undefined
        ) {
          return;
        }

        const editedSinceSave = !isLayoutEqual(savedData, latestLayout.data);
        setLayoutState({
          selectedLayout: {
            id: newLayout.id,
            data: latestLayout.data,
            name: newLayout.name,
            source: "stored",
            ...(editedSinceSave ? { edited: true, editRevision: ++nextEditRevision } : {}),
          },
        });
        void layoutManager.putHistory({ id: newLayout.id });
        void analytics.logEvent(AppEvent.LAYOUT_CREATE);
      } catch (error) {
        if (!isMounted() || selectionGeneration !== layoutSelectionGenerationRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        enqueueSnackbar(t("recommendedLayoutCopyFailed", { message }), { variant: "error" });
      }
    });
  }, [
    analytics,
    confirm,
    enqueueSnackbar,
    isMounted,
    layoutManager,
    setLayoutState,
    t,
    withRecommendedLayoutCopyLock,
  ]);

  const performAction = useCallback(
    (action: PanelsActions) => {
      const selectedLayout = layoutStateRef.current.selectedLayout;
      if (selectedLayout?.data == undefined || selectedLayout.loading === true) {
        return;
      }
      const oldData = selectedLayout.data;
      const newData = panelsReducer(oldData, action);

      // The panel state did not change, so no need to perform layout state
      // updates or layout manager updates.
      if (_.isEqual(oldData, newData)) {
        log.warn("Panel action resulted in identical config:", action);
        return;
      }

      if (selectedLayout.source === "recommended") {
        const isInitialization =
          action.type === "SAVE_PANEL_CONFIGS" && action.source === "initialization";
        setLayoutState({
          selectedLayout: {
            ...selectedLayout,
            data: newData,
            loading: false,
            ...(isInitialization ? {} : { edited: true, editRevision: ++nextEditRevision }),
            source: "recommended",
          },
        });
        return;
      }

      setLayoutState({
        selectedLayout: {
          id: selectedLayout.id,
          data: newData,
          loading: false,
          name: selectedLayout.name,
          edited: true,
          editRevision: ++nextEditRevision,
          source: "stored",
          ...(selectedLayout.transient === true ? { transient: true } : {}),
        },
      });
    },
    [setLayoutState],
  );

  const updateSharedPanelState = useCallback<ICurrentLayout["actions"]["updateSharedPanelState"]>(
    (type, newSharedState) => {
      if (layoutStateRef.current.selectedLayout?.data == undefined) {
        return;
      }

      setLayoutState({
        ...layoutStateRef.current,
        sharedPanelState: { ...layoutStateRef.current.sharedPanelState, [type]: newSharedState },
      });
    },
    [setLayoutState],
  );

  // Changes to the layout storage from external user actions (such as resetting a layout to a
  // previous saved state) need to trigger setLayoutState.
  useEffect(() => {
    const listener: LayoutManagerEventTypes["change"] = (event) => {
      const { updatedLayout } = event;
      const currentSelectedLayout = layoutStateRef.current.selectedLayout;
      if (updatedLayout && updatedLayout.id === currentSelectedLayout?.id) {
        const updatedData = updatedLayout.working?.data ?? updatedLayout.baseline.data;
        const dataChanged =
          currentSelectedLayout.data != undefined &&
          !isLayoutEqual(updatedData, currentSelectedLayout.data);
        if (
          dataChanged &&
          currentSelectedLayout.edited === true &&
          (event.source === "update" || event.source === "overwrite")
        ) {
          setLayoutState({
            selectedLayout: {
              ...currentSelectedLayout,
              loading: false,
              id: updatedLayout.id,
              name: updatedLayout.name,
              source: "stored",
            },
          });
          return;
        }

        setLayoutState({
          selectedLayout: {
            loading: false,
            id: updatedLayout.id,
            data: updatedData,
            name: updatedLayout.name,
            source: "stored",
            ...(event.source === "revert" ? { editRevision: ++nextEditRevision } : {}),
          },
        });
      }
    };
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, setLayoutState]);

  // Make sure our layout still exists after changes. If not deselect it.
  useEffect(() => {
    const listener: LayoutManagerEventTypes["change"] = async (event) => {
      if (event.type !== "delete" || !layoutStateRef.current.selectedLayout?.id) {
        return;
      }

      if (event.layoutId === layoutStateRef.current.selectedLayout.id) {
        // 删除后选择拥有的第一个layout
        const layouts = await layoutManager.getLayouts();
        await setSelectedLayoutId(layouts[0]?.id);
      }
    };

    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [enqueueSnackbar, layoutManager, setSelectedLayoutId]);

  const actions: ICurrentLayout["actions"] = useMemo(
    () => ({
      updateSharedPanelState,
      setCurrentLayout,
      setSelectedLayoutId,
      saveRecommendedLayout,
      withRecommendedLayoutCopyLock,
      getCurrentLayoutState: () => layoutStateRef.current,

      savePanelConfigs: (payload: SaveConfigsPayload, options) => {
        performAction({
          type: "SAVE_PANEL_CONFIGS",
          payload,
          ...(options?.source != undefined ? { source: options.source } : {}),
        });
      },
      updatePanelConfigs: (
        panelType: string,
        perPanelFunc: (config: PanelConfig) => PanelConfig,
      ) => {
        performAction({ type: "SAVE_FULL_PANEL_CONFIG", payload: { panelType, perPanelFunc } });
      },
      createTabPanel: (payload: CreateTabPanelPayload) => {
        performAction({ type: "CREATE_TAB_PANEL", payload });
        setSelectedPanelIds([]);
        void analytics.logEvent(AppEvent.PANEL_ADD, { type: "Tab" });
      },
      changePanelLayout: (payload: ChangePanelLayoutPayload) => {
        performAction({ type: "CHANGE_PANEL_LAYOUT", payload });
      },
      overwriteGlobalVariables: (payload: Record<string, VariableValue>) => {
        performAction({ type: "OVERWRITE_GLOBAL_DATA", payload });
      },
      setGlobalVariables: (payload: Record<string, VariableValue>) => {
        performAction({ type: "SET_GLOBAL_DATA", payload });
      },
      setUserScripts: (payload: Partial<UserScripts>) => {
        performAction({ type: "SET_USER_NODES", payload });
      },
      closePanel: (payload: ClosePanelPayload) => {
        performAction({ type: "CLOSE_PANEL", payload });

        const closedId = getNodeAtPath(payload.root, payload.path);
        // Deselect the removed panel
        setSelectedPanelIds((ids) => ids.filter((id) => id !== closedId));

        void analytics.logEvent(
          AppEvent.PANEL_DELETE,
          typeof closedId === "string" ? { type: getPanelTypeFromId(closedId) } : undefined,
        );
      },
      splitPanel: (payload: SplitPanelPayload) => {
        performAction({ type: "SPLIT_PANEL", payload });
      },
      swapPanel: (payload: SwapPanelPayload) => {
        // Select the new panel if the original panel was selected. We don't know what
        // the new panel id will be so we diff the panelIds of the old and
        // new layout so we can select the new panel.
        const originalIsSelected = selectedPanelIds.current.includes(payload.originalId);
        const beforePanelIds = Object.keys(
          layoutStateRef.current.selectedLayout?.data?.configById ?? {},
        );
        performAction({ type: "SWAP_PANEL", payload });
        if (originalIsSelected) {
          const afterPanelIds = Object.keys(
            layoutStateRef.current.selectedLayout?.data?.configById ?? {},
          );
          setSelectedPanelIds(_.difference(afterPanelIds, beforePanelIds));
        }
        void analytics.logEvent(AppEvent.PANEL_ADD, { type: payload.type, action: "swap" });
        void analytics.logEvent(AppEvent.PANEL_DELETE, {
          type: getPanelTypeFromId(payload.originalId),
          action: "swap",
        });
      },
      moveTab: (payload: MoveTabPayload) => {
        performAction({ type: "MOVE_TAB", payload });
      },
      addPanel: (payload: AddPanelPayload) => {
        performAction({ type: "ADD_PANEL", payload });
        void analytics.logEvent(AppEvent.PANEL_ADD, { type: getPanelTypeFromId(payload.id) });
      },
      dropPanel: (payload: DropPanelPayload) => {
        performAction({ type: "DROP_PANEL", payload });
        void analytics.logEvent(AppEvent.PANEL_ADD, {
          type: payload.newPanelType,
          action: "drop",
        });
      },
      startDrag: (payload: StartDragPayload) => {
        performAction({ type: "START_DRAG", payload });
      },
      endDrag: (payload: EndDragPayload) => {
        performAction({ type: "END_DRAG", payload });
      },
    }),
    [
      analytics,
      performAction,
      saveRecommendedLayout,
      setCurrentLayout,
      setSelectedLayoutId,
      setSelectedPanelIds,
      updateSharedPanelState,
      withRecommendedLayoutCopyLock,
    ],
  );

  const value: ICurrentLayout = useShallowMemo({
    addLayoutStateListener,
    removeLayoutStateListener,
    addSelectedPanelIdsListener,
    removeSelectedPanelIdsListener,
    mosaicId,
    getSelectedPanelIds,
    setSelectedPanelIds,
    actions,
  });

  return (
    <CurrentLayoutContext.Provider value={value}>
      {children}
      {incompatibleLayoutVersionError && (
        <IncompatibleLayoutVersionAlert
          onClose={() => {
            setIncompatibleLayoutVersionError(false);
          }}
        />
      )}
    </CurrentLayoutContext.Provider>
  );
}
