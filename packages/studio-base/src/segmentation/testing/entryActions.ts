// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationImageEntryActions } from "../components/SegmentationImageEntry";

let current: SegmentationImageEntryActions | undefined;

/** Pass as `onActionsChange`: it stands in for the Image panel toolbar. Tests only. */
export function recordEntryActions(actions: SegmentationImageEntryActions | undefined): void {
  current = actions;
}

/** Enters annotation as the "Edit spatial annotation" entries do. Tests only. */
export function enterSegmentation(mode: "inline" | "maximize" = "inline"): void {
  if (!current) {
    throw new Error("No mounted SegmentationImageEntry offers entry actions");
  }
  if (mode === "maximize") {
    current.enterMaximize();
  } else {
    current.enterInline();
  }
}
