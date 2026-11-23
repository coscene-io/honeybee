// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MaskPlaneCache } from "./maskPlaneCache";
import { createMaskPlaneWorker } from "./maskPlaneWorker";

let shared: MaskPlaneCache | undefined;

/**
 * One Worker and one byte-bounded CPU cache shared by every Image panel. When the last panel
 * unregisters, the worker is terminated and the planes are dropped; the next panel starts afresh.
 */
export function sharedMaskPlaneCache(): MaskPlaneCache {
  if (shared == undefined) {
    const cache: MaskPlaneCache = new MaskPlaneCache(createMaskPlaneWorker, undefined, () => {
      cache.dispose();
      if (shared === cache) {
        shared = undefined;
      }
    });
    shared = cache;
  }
  return shared;
}
