// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect, useMemo } from "react";
import useAsyncFn from "react-use/lib/useAsyncFn";

import Logger from "@foxglove/log";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const log = Logger.getLogger(__filename);
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

export function useCurrentLayout() {
  const layoutManager = useLayoutManager();

  const [layouts, reloadLayouts] = useAsyncFn(
    async () => {
      const layouts = await layoutManager.getLayouts();

      const [projectLayouts, personalLayouts] = _.partition(
        layouts,
        layoutManager.supportsSharing ? layoutIsShared : () => false,
      );

      return {
        // layouts: [...layouts].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        personalFolders: _.uniq(
          personalLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ),
        projectFolders: _.uniq(
          projectLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ),
        personalLayouts: personalLayouts.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        projectLayouts: projectLayouts.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      };
    },
    [layoutManager],
    { loading: true },
  );

  useEffect(() => {
    const listener = () => void reloadLayouts();
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, reloadLayouts]);

  // Start loading on first mount
  useEffect(() => {
    reloadLayouts().catch((err: unknown) => {
      log.error(err);
    });
  }, [reloadLayouts]);

  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const currentLayout = useMemo(() => {
    return [
      ...(layouts.value?.personalLayouts ?? []),
      ...(layouts.value?.projectLayouts ?? []),
    ].find((layout) => layout.id === currentLayoutId);
  }, [layouts, currentLayoutId]);

  return {
    currentLayout,
    layouts,
  };
}
