// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";

const CoSceneLayoutManagerContext = createContext<ILayoutManager | undefined>(undefined);
CoSceneLayoutManagerContext.displayName = "CoSceneLayoutManagerContext";

export function useLayoutManager(): ILayoutManager {
  const ctx = useContext(CoSceneLayoutManagerContext);
  if (ctx == undefined) {
    throw new Error("A LayoutManager provider is required to useLayoutManager");
  }
  return ctx;
}

export default CoSceneLayoutManagerContext;
