// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useLayoutEffect } from "react";

import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { getBrowserSession } from "@foxglove/studio-base/util/browserSession";

/** Close the portal-backed layout browser before the session recovery prompt is painted. */
export function useCloseLayoutDrawerOnSessionChange(): void {
  const { layoutDrawer } = useWorkspaceActions();
  useLayoutEffect(() => {
    const session = getBrowserSession();
    if (!session) {
      return;
    }
    const closeWhenBlocked = () => {
      if (session.getStatus() !== "current" && !session.preservesPlayback()) {
        layoutDrawer.close();
      }
    };
    const unsubscribe = session.subscribe(closeWhenBlocked);
    closeWhenBlocked();
    return unsubscribe;
  }, [layoutDrawer]);
}
