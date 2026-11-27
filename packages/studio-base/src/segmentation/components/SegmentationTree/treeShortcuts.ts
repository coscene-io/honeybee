// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Canvas shortcuts that also apply with focus in the tree: view (F, Shift+F, 0, +/-, hold O),
 * history (Cmd/Ctrl+Z, Shift+Z, Y), help (?) and Esc while drawing. They act on the canvas that
 * holds the edit. Tree-only keys (Enter, typing in a name field) and keys with a different meaning
 * here (Space plays, arrows step frames, Delete) stay with the tree and the app.
 */
const TREE_FORWARDED_KEYS = new Set(["f", "F", "0", "+", "=", "-", "o", "O", "?"]);

function activeCanvasViewport(): HTMLElement | undefined {
  return (
    globalThis.document.querySelector<HTMLElement>(
      '[data-canvas-focused="true"] [data-testid="segmentation-viewport"]',
    ) ??
    globalThis.document.querySelector<HTMLElement>('[data-testid="segmentation-viewport"]') ??
    undefined
  );
}

export function forwardCanvasShortcut(event: ReactKeyboardEvent<HTMLElement>): void {
  const target = event.target;
  if (
    event.defaultPrevented ||
    (target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
      ))
  ) {
    return;
  }
  const history =
    (event.ctrlKey || event.metaKey) && ["z", "Z", "y", "Y"].includes(event.key) && !event.altKey;
  const view =
    !event.ctrlKey && !event.metaKey && !event.altKey && TREE_FORWARDED_KEYS.has(event.key);
  const escape = event.key === "Escape";
  if (!history && !view && !escape) {
    return;
  }
  const viewport = activeCanvasViewport();
  if (!viewport) {
    return;
  }
  const forwarded = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  });
  viewport.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * Whether a keyboard/mouse event belongs to this tree row itself (not a nested row) and was
 * raised by the row or its main button rather than by another control such as a checkbox.
 */
export function ownsRowEvent(target: EventTarget, row: Element): boolean {
  if (!(target instanceof Element) || target.closest('[role="treeitem"]') !== row) {
    return false;
  }
  const control = target.closest("button, input, textarea, select");
  return control == undefined || control.hasAttribute("data-tree-primary");
}
