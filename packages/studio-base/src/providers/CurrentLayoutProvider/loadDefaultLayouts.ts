// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { LayoutLoader } from "@foxglove/studio-base/services/ILayoutLoader";

const log = Logger.getLogger(__filename);

const isFulfilled = <T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> =>
  result.status === "fulfilled";

const isRejected = (result: PromiseSettledResult<unknown>): result is PromiseRejectedResult =>
  result.status === "rejected";

export const loadDefaultLayouts = async (
  layoutManager: ILayoutManager,
  loaders: readonly LayoutLoader[],
): Promise<void> => {
  if (loaders.length === 0) {
    return;
  }

  try {
    const currentLayouts = await layoutManager.getLayouts();
    const currentLayoutsFroms = new Set(currentLayouts.map(({ from }) => from));
    const loaderPromises = loaders.map(async (loader) => await loader.fetchLayouts());
    const loaderResults = await Promise.allSettled(loaderPromises);

    const newLayouts = loaderResults
      .filter(isFulfilled)
      .flatMap(({ value }) => value)
      .filter(({ from }) => !currentLayoutsFroms.has(from));

    // Log errors cause failed to fetch some layout from a specific loader
    loaderResults.filter(isRejected).forEach(({ reason }) => {
      log.error(`Failed to fetch layouts from loader: ${reason}`);
    });

    const savedPromises = newLayouts.map(
      async (layout) =>
        await layoutManager.saveNewLayout({
          ...layout,
          permission: "CREATOR_WRITE",
        }),
    );

    // Try to save all layouts
    const savedResults = await Promise.allSettled(savedPromises);

    // Log errors cause failed to save a layout
    savedResults.filter(isRejected).forEach(({ reason }) => {
      log.error(`Failed to save layout: ${reason}`);
    });
  } catch (err: unknown) {
    log.error(`Loading default layouts failed: ${err}`);
  }
};
