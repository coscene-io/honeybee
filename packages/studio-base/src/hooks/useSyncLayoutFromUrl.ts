// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useRef, useState } from "react";
import { useAsync } from "react-use";

import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { ExternalInitConfig } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

/**
 * Synchronizes the layout from URL state after externalInitConfig is initialized
 */
export function useSyncLayoutFromUrl(
  targetUrlState: AppURLState | undefined,
  externalInitConfig: ExternalInitConfig | undefined,
): void {
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const { layoutDrawer } = useWorkspaceActions();
  const layoutManager = useLayoutManager();

  const isLayoutIdProcessed = useRef(false);
  const [{ layoutId }, setUnappliedLayoutArgs] = useState(
    targetUrlState
      ? {
        layoutId: targetUrlState.layoutId,
      }
      : {
        layoutId: undefined,
      },
  );

  useAsync(async () => {
    // 只有在 externalInitConfig 初始化完成后才处理 layout
    if (externalInitConfig?.isInitialized !== true) {
      return;
    }

    // 如果已经有 layout 或已经初始化过，不再处理
    if (currentLayoutId || isLayoutIdProcessed.current) {
      return;
    }

    // Don't restore the layout if there's one specified in the app state url.
    if (layoutId) {
      const urlLayout = await layoutManager.getLayout({ id: layoutId });
      if (urlLayout) {
        setSelectedLayoutId(layoutId);
        setUnappliedLayoutArgs({ layoutId: undefined });
        isLayoutIdProcessed.current = true;
        return;
      }
    }

    // 尝试从历史记录中恢复 layout
    const layout = await layoutManager.getHistory();
    if (layout) {
      setSelectedLayoutId(layout.id);
      setUnappliedLayoutArgs({ layoutId: undefined });
      isLayoutIdProcessed.current = true;
      return;
    }

    // 如果没有 layout，打开 layout drawer
    layoutDrawer.open();
    setUnappliedLayoutArgs({ layoutId: undefined });
    isLayoutIdProcessed.current = true;
  }, [
    currentLayoutId,
    setSelectedLayoutId,
    layoutId,
    layoutManager,
    layoutDrawer,
    externalInitConfig?.isInitialized,
  ]);
}
