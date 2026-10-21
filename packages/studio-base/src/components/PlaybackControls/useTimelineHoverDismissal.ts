// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";

/** Element leave events alone can miss a fast exit from the browser viewport. */
export function useTimelineHoverDismissal(dismiss: () => void): void {
  useEffect(() => {
    const onPointerOut = (event: MouseEvent) => {
      if (event.relatedTarget == undefined) {
        dismiss();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        dismiss();
      }
    };

    // Capture viewport exits even if a child stops propagation.
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("mouseout", onPointerOut, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("mouseout", onPointerOut, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", dismiss);
    };
  }, [dismiss]);
}
