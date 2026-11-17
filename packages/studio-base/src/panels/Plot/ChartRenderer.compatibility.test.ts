/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Chart, registerables } from "chart.js";

import { ChartRenderer } from "./ChartRenderer";

it("keeps the zoom fork's worker wheel and pan bridge compatible with Chart.js 4", () => {
  Chart.register(...registerables);
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  // Select Chart.js's real BasicPlatform as in the worker; canvas drawing comes from jest-canvas-mock.
  globalThis.OffscreenCanvas = HTMLCanvasElement as unknown as typeof OffscreenCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 400;
  try {
    const renderer = new ChartRenderer({
      canvas: canvas as unknown as OffscreenCanvas,
      devicePixelRatio: 1,
      gridColor: "#888",
      tickColor: "#fff",
    });
    renderer.updateDatasets([
      {
        data: [
          { x: 0, y: 0 },
          { x: 100, y: 1 },
        ],
      },
    ]);
    const initial = renderer.update({
      type: "update",
      xBounds: { min: 0, max: 100 },
      yBounds: { min: 0, max: 1 },
    })!;
    const base = {
      boundingClientRect: new DOMRect(0, 0, 600, 400),
      deltaX: 0,
      deltaY: 0,
      cancelable: false,
    };
    const zoomed = renderer.update({
      type: "update",
      interactionEvents: [{ ...base, type: "wheel", clientX: 300, clientY: 200, deltaY: -100 }],
    })!;
    expect(zoomed.x.max - zoomed.x.min).toBeLessThan(initial.x.max - initial.x.min);
    const panned = renderer.update({
      type: "update",
      interactionEvents: [
        { ...base, type: "panstart", center: { x: 300, y: 200 } },
        { ...base, type: "panmove", deltaX: 40 },
        { ...base, type: "panend" },
      ],
    })!;
    expect(panned.x.min).not.toBe(zoomed.x.min);
    expect(panned.x.max - panned.x.min).toBeCloseTo(zoomed.x.max - zoomed.x.min);
  } finally {
    Chart.getChart(canvas)?.destroy();
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
