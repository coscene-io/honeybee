/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isAnnotationCanvasTarget, isAnnotationViewportTarget } from "./annotationInput";

describe("annotation input ownership", () => {
  it.each([
    "<div data-target></div>",
    '<svg><circle role="button" data-target /></svg>',
    '<svg><g role="button"><circle data-target /></g></svg>',
    '<div contenteditable="false"><span data-target></span></div>',
  ])("owns annotation surfaces and SVG vertices: %s", (markup) => {
    const viewport = document.createElement("div");
    viewport.dataset.segmentationInput = "canvas";
    viewport.innerHTML = markup;

    expect(isAnnotationCanvasTarget(viewport)).toBe(true);
    expect(isAnnotationCanvasTarget(viewport.querySelector("[data-target]"))).toBe(true);
  });

  it.each([
    "<input data-target />",
    "<textarea data-target></textarea>",
    "<select data-target><option>One</option></select>",
    "<button><span data-target>Retry</span></button>",
    "<button><svg><path data-target /></svg></button>",
    '<a href="#"><span data-target>Help</span></a>',
    '<div role="button"><span data-target>Retry</span></div>',
    '<div role="textbox"><span data-target>Editor</span></div>',
    '<div contenteditable="true"><span data-target>Editor</span></div>',
    '<div contenteditable=""><span data-target>Editor</span></div>',
    '<div contenteditable="plaintext-only"><span data-target>Editor</span></div>',
  ])("leaves native controls their keyboard semantics: %s", (markup) => {
    const viewport = document.createElement("div");
    viewport.dataset.segmentationInput = "canvas";
    viewport.innerHTML = markup;
    const target = viewport.querySelector("[data-target]");

    expect(isAnnotationCanvasTarget(target)).toBe(false);
    expect(isAnnotationViewportTarget(target)).toBe(true);
  });

  it("does not claim unrelated targets or markers", () => {
    const outside = document.createElement("div");
    outside.innerHTML = '<div data-segmentation-input="toolbar"><span></span></div>';
    for (const target of [
      new Event("keydown").target,
      document,
      window,
      new EventTarget(),
      outside.querySelector("span"),
    ]) {
      expect(isAnnotationCanvasTarget(target)).toBe(false);
      expect(isAnnotationViewportTarget(target)).toBe(false);
    }
  });
});
