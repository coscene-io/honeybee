// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isMacUserAgent } from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcuts";
import type { segmentation } from "@foxglove/studio-base/i18n/en/segmentation";

type SegmentationKey = keyof typeof segmentation;

type SegmentationShortcutRow = {
  labelKey: SegmentationKey;
  keys: readonly string[];
};

type SegmentationShortcutSection = {
  titleKey: SegmentationKey;
  rows: readonly SegmentationShortcutRow[];
};

/**
 * Annotation-canvas bindings, matching what SegmentationCanvas handles. `drag` and `click` are the
 * localized words used inside chords such as "Space + drag"; they cannot live in this table because
 * the translation is only available at the call site.
 */
export function getSegmentationShortcuts(
  currentUserAgent: string,
  words: { drag: string; click: string } = { drag: "drag", click: "click" },
): {
  sections: readonly SegmentationShortcutSection[];
  byAction: Record<
    "fit" | "fitSelection" | "actualSize" | "zoomIn" | "zoomOut" | "panTool",
    readonly string[]
  >;
} {
  const mac = isMacUserAgent(currentUserAgent);
  const mod = mac ? "⌘" : "Ctrl";
  const byAction = {
    fit: ["F"],
    fitSelection: ["Shift + F"],
    actualSize: ["0"],
    zoomIn: ["+"],
    zoomOut: ["−"],
    panTool: ["H"],
  } as const;
  return {
    byAction,
    sections: [
      {
        titleKey: "shortcutSectionView",
        rows: [
          { labelKey: "shortcutFit", keys: byAction.fit },
          { labelKey: "shortcutFitSelection", keys: byAction.fitSelection },
          { labelKey: "shortcutActualSize", keys: byAction.actualSize },
          { labelKey: "shortcutZoom", keys: [...byAction.zoomIn, ...byAction.zoomOut] },
          { labelKey: "shortcutPanTool", keys: byAction.panTool },
          { labelKey: "shortcutTemporaryPan", keys: [`Space + ${words.drag}`] },
          { labelKey: "shortcutViewOriginal", keys: ["O"] },
        ],
      },
      {
        titleKey: "shortcutSectionEdit",
        rows: [
          { labelKey: "shortcutToggleEditing", keys: ["Enter"] },
          { labelKey: "shortcutCancel", keys: ["Esc"] },
          { labelKey: "shortcutDeleteVertices", keys: ["Delete", "Backspace"] },
          {
            labelKey: "shortcutDeleteVertex",
            keys: [`${mac ? "Option" : "Alt"} + ${words.click}`],
          },
          { labelKey: "shortcutNudge", keys: ["←", "↑", "↓", "→"] },
          { labelKey: "shortcutNudgeLarge", keys: ["Shift + ←↑↓→"] },
        ],
      },
      {
        titleKey: "shortcutSectionHistory",
        rows: [
          { labelKey: "shortcutUndo", keys: [`${mod} + Z`] },
          {
            labelKey: "shortcutRedo",
            keys: mac ? [`${mod} + Shift + Z`] : [`${mod} + Shift + Z`, `${mod} + Y`],
          },
        ],
      },
      {
        titleKey: "shortcutSectionFrames",
        rows: [
          { labelKey: "shortcutStepFrame", keys: ["←", "→"] },
          { labelKey: "shortcutStepFrameLarge", keys: ["Shift + ←", "Shift + →"] },
        ],
      },
    ],
  };
}

export const SEGMENTATION_SHORTCUTS = getSegmentationShortcuts(
  typeof navigator !== "undefined" ? navigator.userAgent : "",
).byAction;
