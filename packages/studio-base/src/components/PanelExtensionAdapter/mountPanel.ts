// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Mount an independent panel root and return its synchronous, idempotent cleanup. */
export function mountPanel(panelElement: HTMLElement, content: ReactNode): () => void {
  const root = createRoot(panelElement);
  root.render(content);

  let unmounted = false;
  return () => {
    if (unmounted) {
      return;
    }
    unmounted = true;
    // PanelExtensionAdapter schedules cleanup outside the parent React commit.
    root.unmount();
  };
}
