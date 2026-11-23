// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  inputOwnerProps,
  isInputOwnerSurfaceTarget,
} from "@foxglove/studio-base/components/inputOwnership";

const ANNOTATION_VIEWPORT_ATTRIBUTE = "data-segmentation-input";
const ANNOTATION_VIEWPORT_SELECTOR = `[${ANNOTATION_VIEWPORT_ATTRIBUTE}="canvas"]`;

/**
 * Props for the annotation viewport. It owns keyboard and context-menu input; ←/→ still reach
 * global shortcuts (stepping camera frames) unless the canvas consumed them.
 */
export const annotationViewportProps = {
  [ANNOTATION_VIEWPORT_ATTRIBUTE]: "canvas",
  ...inputOwnerProps(["ArrowLeft", "ArrowRight"]),
} as const;

/** Props for popups the viewport opens (menus), which own every key. */
export const annotationPopupProps = {
  [ANNOTATION_VIEWPORT_ATTRIBUTE]: "canvas",
  ...inputOwnerProps(),
} as const;

/** Includes native controls inside the viewport, for input-routing guards. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isAnnotationViewportTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ANNOTATION_VIEWPORT_SELECTOR) != undefined;
}

/** Whether annotation shortcuts own this target, leaving native controls their normal semantics. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isAnnotationCanvasTarget(target: EventTarget | null): boolean {
  return isAnnotationViewportTarget(target) && isInputOwnerSurfaceTarget(target);
}
