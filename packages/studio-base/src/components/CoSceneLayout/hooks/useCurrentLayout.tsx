// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect } from "react";
import useAsyncFn, { AsyncState } from "react-use/lib/useAsyncFn";

import Logger from "@foxglove/log";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { Layout, layoutIsProject } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const log = Logger.getLogger(__filename);

export function useCurrentLayout(): AsyncState<{
  personalFolders: string[];
  projectFolders: string[];
  allLayouts: Layout[];
}> {
  const layoutManager = useLayoutManager();

  const [layouts, reloadLayouts] = useAsyncFn(
    async () => {
      const layouts = await layoutManager.getLayouts();

      const [projectLayouts, personalLayouts] = _.partition(
        layouts,
        layoutManager.supportsSharing ? layoutIsProject : () => false,
      );

      return {
        personalFolders: _.uniq(
          personalLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ).sort((a, b) => a.localeCompare(b)),
        projectFolders: _.uniq(
          projectLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ).sort((a, b) => a.localeCompare(b)),
        allLayouts: [...layouts].sort((a, b) => a.name.localeCompare(b.name)),
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

  return layouts;
}
