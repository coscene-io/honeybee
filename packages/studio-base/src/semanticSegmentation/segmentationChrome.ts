// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

/** One image panel that can open the record's annotation space. */
export type SegmentationCanvasEntry = {
  panelId: string;
  topic?: string;
  enterInline: () => void;
  enterMaximize: () => void;
  /** On-screen area in CSS pixels, used to pick the main canvas. */
  area?: () => number;
};

type SegmentationChromeState = {
  canvases: SegmentationCanvasEntry[];
};

/** Live image panels. The app bar is the only host of annotation controls. */
export const segmentationChrome = createStore<SegmentationChromeState>(() => ({
  canvases: [],
}));

/**
 * Registers a canvas. The returned function removes this registration only.
 * A newer registration for the same panel survives an older cleanup.
 */
export function registerSegmentationCanvas(entry: SegmentationCanvasEntry): () => void {
  segmentationChrome.setState((state) => ({
    canvases: [...state.canvases.filter((canvas) => canvas.panelId !== entry.panelId), entry],
  }));
  let current = true;
  return () => {
    if (!current) {
      return;
    }
    current = false;
    segmentationChrome.setState((state) => ({
      canvases: state.canvases.filter((canvas) => canvas !== entry),
    }));
  };
}

/** Short camera name from a topic path. The full topic stays on the button title. */
export function segmentationCanvasLabel(topic: string | undefined): string {
  const parts = topic?.split("/").filter((part) => part.length > 0) ?? [];
  return parts[1] ?? parts[0] ?? "图像";
}

/** The largest canvas on screen, where a new session starts. The first one wins a tie. */
export function mainSegmentationCanvas(
  canvases: readonly SegmentationCanvasEntry[],
): SegmentationCanvasEntry | undefined {
  let main: SegmentationCanvasEntry | undefined;
  let mainArea = -1;
  for (const canvas of canvases) {
    const area = canvas.area?.() ?? 0;
    if (area > mainArea) {
      main = canvas;
      mainArea = area;
    }
  }
  return main;
}
