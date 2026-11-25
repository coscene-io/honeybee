// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Colours drawn over camera images. They do not follow the app theme: they have to read on any
 * picture, in either theme.
 */
export const OVERLAY_COLORS = {
  /** Insertion indicator, paint brush and selection rectangle. */
  accent: "#4c8dff",
  accentStrong: "#2b6bd4",
  accentFill: "rgba(76, 141, 255, 0.15)",
  focusRing: "#82b4ff",
  erase: "#ff5252",
  positivePoint: "#00c853",
  negativePoint: "#ff1744",
  draftVertex: "#00bfa5",
  /** A mask or polygon whose class has no colour. */
  unclassified: "#00897b",
  previewStroke: "#55b8de",
  previewFill: "rgba(85, 184, 222, 0.28)",
} as const;
