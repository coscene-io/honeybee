// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const ANNOTATION_VIEWPORT_SELECTOR = '[data-segmentation-input="canvas"]';

/** Includes native controls inside the viewport, for parent input-routing guards. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isAnnotationViewportTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ANNOTATION_VIEWPORT_SELECTOR) != undefined;
}

/** Whether annotation shortcuts own this target, leaving native controls their normal semantics. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isAnnotationCanvasTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !isAnnotationViewportTarget(target)) {
    return false;
  }

  if (target.closest('input, textarea, select, button, a[href], [role="textbox"]') != undefined) {
    return false;
  }

  const editable = target.closest("[contenteditable]");
  if (editable != undefined && editable.getAttribute("contenteditable") !== "false") {
    return false;
  }

  // SVG vertices use role=button for accessibility, but are annotation controls.
  const button = target.closest('[role="button"]');
  return !(button instanceof HTMLElement);
}
