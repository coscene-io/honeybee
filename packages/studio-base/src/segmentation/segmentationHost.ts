// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSegmentationRegistry, createSegmentationSession } from "./runtime";
import type { SegmentationHost } from "./segmentationHostContext";

/** A new, empty host: its own session and runtime registry, shared by nothing else. */
export function createSegmentationHost(): SegmentationHost {
  const session = createSegmentationSession();
  const registry = createSegmentationRegistry(session);
  return {
    session,
    registry,
    dispose: () => {
      registry.dispose();
    },
  };
}
