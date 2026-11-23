// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { segmentationSession, type SegmentationSurface } from "../runtime";

/** The surface of the panel holding the edit. Tests only. */
export function focusedSurface(): SegmentationSurface | undefined {
  const { panelId, surfaces } = segmentationSession.getState();
  return panelId == undefined ? undefined : surfaces[panelId];
}

/** Image URL the panel holding the edit shows. Tests only. */
export function focusedImageUrl(): string | undefined {
  return focusedSurface()?.imageUrl;
}
