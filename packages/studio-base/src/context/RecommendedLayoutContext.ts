// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import type { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import type { RecommendedLayoutDescriptor } from "@foxglove/studio-base/services/RecommendedLayouts";

export type RecommendedLayoutState =
  | { status: "loading"; layouts: readonly RecommendedLayoutDescriptor[] }
  | {
      status: "ready";
      robot?: string;
      layouts: readonly RecommendedLayoutDescriptor[];
      automaticLayout?: RecommendedLayoutDescriptor;
    }
  | { status: "error"; layouts: readonly RecommendedLayoutDescriptor[]; error: Error };

export type RecommendedLayoutContextValue = RecommendedLayoutState & {
  loadLayout: (descriptor: RecommendedLayoutDescriptor) => Promise<LayoutData>;
};

export const RecommendedLayoutContext = createContext<RecommendedLayoutContextValue | undefined>(
  undefined,
);

export function useRecommendedLayouts(): RecommendedLayoutContextValue {
  const value = useContext(RecommendedLayoutContext);
  if (!value) {
    throw new Error("RecommendedLayoutContext is not available");
  }
  return value;
}
