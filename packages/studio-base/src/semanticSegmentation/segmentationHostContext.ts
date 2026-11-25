// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

import type {
  SegmentationRegistry,
  SegmentationSession,
  SegmentationSessionState,
} from "./runtime";

/**
 * Everything one spatial-annotation workspace shares between its image panels, sidebar and app
 * bar: the session (what is open, which panel edits), the runtime registry, and what later layers
 * add. It is created by whoever mounts the feature and reached through `SegmentationHostContext`;
 * there is no module-level instance. `createSegmentationHost` builds one.
 */
export type SegmentationHost = {
  session: SegmentationSession;
  registry: SegmentationRegistry;
  /** Releases every runtime and listener the host holds. Called when its owner unmounts. */
  dispose: () => void;
};

export const SegmentationHostContext = createContext<SegmentationHost | undefined>(undefined);

/** The host of the enclosing workspace. Throws outside one (the feature is flag-gated). */
export function useSegmentationHost(): SegmentationHost {
  return useGuaranteedContext(SegmentationHostContext);
}

/** Reads the session with a selector, like `useCoreData`. */
export function useSegmentationSession<T>(selector: (state: SegmentationSessionState) => T): T {
  return useStore(useSegmentationHost().session, selector);
}
