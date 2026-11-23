// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Generic hook point for a region that owns its keyboard and context-menu input, so global
 * shortcuts (KeyListener) and the panel context menu stay out of its way.
 *
 * Mark the region with `data-owns-input`. Its value is an optional space-separated list of
 * `KeyboardEvent.key` values that still reach global shortcut listeners when the event comes from
 * the region's own surface (not from a native control inside it), and the region did not consume
 * the event first.
 *
 * Shared code depends only on this module, never on the feature that owns the region.
 */
const INPUT_OWNER_ATTRIBUTE = "data-owns-input";
const INPUT_OWNER_SELECTOR = `[${INPUT_OWNER_ATTRIBUTE}]`;
const NATIVE_CONTROL_SELECTOR = 'input, textarea, select, button, a[href], [role="textbox"]';

/** Props that mark an element as an input owner, letting `passKeys` through to global listeners. */
export function inputOwnerProps(passKeys: readonly string[] = []): {
  [INPUT_OWNER_ATTRIBUTE]: string;
} {
  return { [INPUT_OWNER_ATTRIBUTE]: passKeys.join(" ") };
}

// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
function inputOwner(target: EventTarget | null): Element | undefined {
  return target instanceof Element
    ? (target.closest(INPUT_OWNER_SELECTOR) ?? undefined)
    : undefined;
}

/** Whether the target is inside an input-owning region, including native controls inside it. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isInputOwnedTarget(target: EventTarget | null): boolean {
  return inputOwner(target) != undefined;
}

/**
 * Whether the target is the owning region's own surface, as opposed to a native control (button,
 * text field, link, contenteditable) inside it that keeps its normal semantics.
 */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function isInputOwnerSurfaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || inputOwner(target) == undefined) {
    return false;
  }
  if (target.closest(NATIVE_CONTROL_SELECTOR) != undefined) {
    return false;
  }
  const editable = target.closest("[contenteditable]");
  if (editable != undefined && editable.getAttribute("contenteditable") !== "false") {
    return false;
  }
  // SVG shapes may use role=button for accessibility while still being part of the surface.
  return !(target.closest('[role="button"]') instanceof HTMLElement);
}

/** Whether a global listener may handle `key` for a target inside an input-owning region. */
// eslint-disable-next-line no-restricted-syntax -- DOM Event.target is nullable.
export function inputOwnerPassesKey(target: EventTarget | null, key: string): boolean {
  const owner = inputOwner(target);
  if (owner == undefined || !isInputOwnerSurfaceTarget(target)) {
    return false;
  }
  const passKeys = owner.getAttribute(INPUT_OWNER_ATTRIBUTE)?.split(" ") ?? [];
  return passKeys.includes(key);
}
