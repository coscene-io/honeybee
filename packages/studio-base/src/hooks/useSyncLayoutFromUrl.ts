// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useRecommendedLayouts } from "@foxglove/studio-base/context/RecommendedLayoutContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import {
  defaultRemoteMp4Layout,
  REMOTE_MP4_DEFAULT_LAYOUT_ID,
  REMOTE_MP4_DEFAULT_LAYOUT_NAME,
} from "@foxglove/studio-base/providers/CurrentLayoutProvider/defaultRemoteMp4Layout";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
const selectIsReadyForSyncLayout = (state: CoreDataStore) => state.isReadyForSyncLayout;

/**
 * Synchronizes the layout from URL state after isReadyForSyncLayout is true
 */
export function useSyncLayoutFromUrl(targetUrlState: AppURLState | undefined): void {
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { getCurrentLayoutState, setCurrentLayout, setSelectedLayoutId } =
    useCurrentLayoutActions();
  const { layoutDrawer } = useWorkspaceActions();
  const layoutManager = useLayoutManager();
  const isReadyForSyncLayout = useCoreData(selectIsReadyForSyncLayout);
  const recommendedLayouts = useRecommendedLayouts();
  const recommendedLayoutsRef = useRef(recommendedLayouts);
  recommendedLayoutsRef.current = recommendedLayouts;
  const { enqueueSnackbar } = useSnackbar();
  const { t } = useTranslation("layout");

  const isLayoutIdProcessed = useRef(false);
  const [{ layoutId }, setUnappliedLayoutArgs] = useState(() => {
    return { layoutId: targetUrlState?.layoutId };
  });

  useAsync(async () => {
    // 只有在 isReadyForSyncLayout 为 true 时才处理 layout
    if (isReadyForSyncLayout !== true) {
      return;
    }

    // remote-mp4 always uses the single Image panel on the fixed topic.
    // Do not restore history, recommended layouts, or URL layoutId.
    if (targetUrlState?.ds === "remote-mp4") {
      if (currentLayoutId === REMOTE_MP4_DEFAULT_LAYOUT_ID || isLayoutIdProcessed.current) {
        return;
      }
      setCurrentLayout({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: defaultRemoteMp4Layout,
        transient: true,
      });
      setUnappliedLayoutArgs({ layoutId: undefined });
      isLayoutIdProcessed.current = true;
      return;
    }

    // 如果已经有 layout 或已经初始化过，不再处理
    if (currentLayoutId || isLayoutIdProcessed.current) {
      return;
    }

    if (layoutId) {
      if (layoutId.startsWith("recommended:")) {
        if (recommendedLayouts.status === "loading") {
          return;
        }
        const descriptor = recommendedLayouts.layouts.find((item) => item.id === layoutId);
        if (descriptor) {
          try {
            const data = await recommendedLayouts.loadLayout(descriptor);
            if (
              !recommendedLayoutsRef.current.layouts.some(
                (layout) => layout.id === descriptor.id && layout.url === descriptor.url,
              )
            ) {
              return;
            }
            if (getCurrentLayoutState().selectedLayout != undefined) {
              setUnappliedLayoutArgs({ layoutId: undefined });
              isLayoutIdProcessed.current = true;
              return;
            }
            setCurrentLayout({
              id: descriptor.id,
              name: descriptor.name,
              data,
              source: "recommended",
              recommendedLayout: descriptor,
            });
            setUnappliedLayoutArgs({ layoutId: undefined });
            isLayoutIdProcessed.current = true;
            return;
          } catch (error) {
            if (
              !recommendedLayoutsRef.current.layouts.some(
                (layout) => layout.id === descriptor.id && layout.url === descriptor.url,
              )
            ) {
              return;
            }
            if (getCurrentLayoutState().selectedLayout != undefined) {
              setUnappliedLayoutArgs({ layoutId: undefined });
              isLayoutIdProcessed.current = true;
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            enqueueSnackbar(t("recommendedLayoutLoadFailed", { message }), { variant: "error" });
          }
        }
      } else {
        const urlLayout = await layoutManager.getLayout({ id: layoutId });
        if (getCurrentLayoutState().selectedLayout != undefined) {
          setUnappliedLayoutArgs({ layoutId: undefined });
          isLayoutIdProcessed.current = true;
          return;
        }
        if (urlLayout) {
          setSelectedLayoutId(layoutId);
          setUnappliedLayoutArgs({ layoutId: undefined });
          isLayoutIdProcessed.current = true;
          return;
        }
      }
    }

    // 尝试从历史记录中恢复 layout
    const layout = await layoutManager.getHistory();
    if (getCurrentLayoutState().selectedLayout != undefined) {
      setUnappliedLayoutArgs({ layoutId: undefined });
      isLayoutIdProcessed.current = true;
      return;
    }
    if (layout) {
      setSelectedLayoutId(layout.id);
      setUnappliedLayoutArgs({ layoutId: undefined });
      isLayoutIdProcessed.current = true;
      return;
    }

    if (recommendedLayouts.status === "loading") {
      return;
    }

    if (recommendedLayouts.status === "ready" && recommendedLayouts.automaticLayout) {
      const descriptor = recommendedLayouts.automaticLayout;
      try {
        const data = await recommendedLayouts.loadLayout(descriptor);
        const latestRecommendedLayouts = recommendedLayoutsRef.current;
        const latestAutomaticLayout =
          latestRecommendedLayouts.status === "ready"
            ? latestRecommendedLayouts.automaticLayout
            : undefined;
        if (
          latestAutomaticLayout?.id !== descriptor.id ||
          latestAutomaticLayout.url !== descriptor.url
        ) {
          return;
        }
        if (getCurrentLayoutState().selectedLayout != undefined) {
          setUnappliedLayoutArgs({ layoutId: undefined });
          isLayoutIdProcessed.current = true;
          return;
        }
        setCurrentLayout({
          id: descriptor.id,
          name: descriptor.name,
          data,
          source: "recommended",
          recommendedLayout: descriptor,
        });
        setUnappliedLayoutArgs({ layoutId: undefined });
        isLayoutIdProcessed.current = true;
        return;
      } catch (error) {
        const latestRecommendedLayouts = recommendedLayoutsRef.current;
        const latestAutomaticLayout =
          latestRecommendedLayouts.status === "ready"
            ? latestRecommendedLayouts.automaticLayout
            : undefined;
        if (
          latestAutomaticLayout?.id !== descriptor.id ||
          latestAutomaticLayout.url !== descriptor.url
        ) {
          return;
        }
        if (getCurrentLayoutState().selectedLayout != undefined) {
          setUnappliedLayoutArgs({ layoutId: undefined });
          isLayoutIdProcessed.current = true;
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        enqueueSnackbar(t("recommendedLayoutLoadFailed", { message }), { variant: "error" });
      }
    }

    // 如果没有 layout，打开 layout drawer
    layoutDrawer.open();
    setUnappliedLayoutArgs({ layoutId: undefined });
    isLayoutIdProcessed.current = true;
  }, [
    currentLayoutId,
    getCurrentLayoutState,
    setSelectedLayoutId,
    setCurrentLayout,
    layoutId,
    layoutManager,
    layoutDrawer,
    isReadyForSyncLayout,
    recommendedLayouts,
    enqueueSnackbar,
    t,
    targetUrlState?.ds,
  ]);
}
