// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { cancelGesture, enterEditMode, finishDrawing, run, switchTool } from "./canvasActions";
import { brushAfterKey, panKeyDelta, toScreen } from "./canvasMath";
import type { CanvasContext } from "./canvasUi";
import { requestQuickMask } from "./quickMask";
import { removeVertices, nudge } from "./vertexEditing";
import { fit, fitSelection, panelView, zoomAt } from "./viewControls";
import { isAnnotationCanvasTarget } from "../../annotationInput";

type KeyEvent = ReactKeyboardEvent<HTMLElement>;

/** A key handler returns true once the key is its own, whether or not it acted on it. */
type KeyHandler = (c: CanvasContext, event: KeyEvent) => boolean;

function consume(event: KeyEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

const isModified = (event: KeyEvent): boolean => event.ctrlKey || event.metaKey;

/** The context-menu key opens the menu at the active vertex, else the viewport center. */
const contextMenuKey: KeyHandler = (c, event) => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
    return false;
  }
  consume(event);
  const bounds = c.ui.viewport.current?.getBoundingClientRect();
  if (c.d.navigationLocked || !bounds) {
    return true;
  }
  const target =
    c.d.activePoint && !c.ui.peekOriginal && !c.ui.panTool && !c.ui.space.current
      ? { type: "vertex" as const, ...c.d.activePoint }
      : undefined;
  const matrix = target ? c.ui.content.current?.getScreenCTM() : undefined;
  const at =
    target && matrix
      ? toScreen(matrix, target.point, c.ui.size.width, c.ui.size.height)
      : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  c.ui.setContextMenu({ x: at.x, y: at.y, keyboard: true, target });
  return true;
};

const spaceKey: KeyHandler = (c, event) => {
  if (event.key !== " ") {
    return false;
  }
  consume(event);
  if (!c.d.navigationLocked && !event.repeat) {
    cancelGesture(c.ui);
    c.ui.space.current = true;
    c.ui.setSpaceHeld(true);
  }
  return true;
};

const undoKey: KeyHandler = (c, event) => {
  if (!isModified(event) || event.key.toLowerCase() !== "z") {
    return false;
  }
  consume(event);
  const live = c.store.getState();
  if (!c.d.locked && (event.shiftKey ? live.canRedo : c.state.stagedOperations.length > 0)) {
    run(c, () => {
      if (event.shiftKey) {
        live.redo();
      } else {
        live.undo();
      }
    });
  }
  return true;
};

const redoKey: KeyHandler = (c, event) => {
  if (!isModified(event) || event.key.toLowerCase() !== "y") {
    return false;
  }
  consume(event);
  if (!c.d.locked && c.store.getState().canRedo) {
    run(c, () => {
      c.store.getState().redo();
    });
  }
  return true;
};

/** Other modified keys belong to the app. */
const modifiedKey: KeyHandler = (_c, event) => isModified(event) || event.altKey;

/** P / Q switch the creation tool; the draft of the other tool is discarded. */
const creationToolKey: KeyHandler = (c, event) => {
  if (!c.d.drawing || c.d.locked || !["p", "P", "q", "Q"].includes(event.key)) {
    return false;
  }
  consume(event);
  switchTool(c, event.key.toLowerCase() === "q" ? "quick" : "polygon");
  return true;
};

const brushKey: KeyHandler = (c, event) => {
  if (!c.d.brushActive || !["b", "B", "e", "E", "[", "]"].includes(event.key)) {
    return false;
  }
  consume(event);
  c.ui.setBrush((current) => brushAfterKey(current, event.key));
  return true;
};

const VIEW_KEYS = ["+", "=", "-", "f", "F", "0", "h", "H", "?", "o", "O"];

/** Zoom, fit, pan tool, shortcuts help and hold-to-peek the original image. */
const viewKey: KeyHandler = (c, event) => {
  if (!VIEW_KEYS.includes(event.key)) {
    return false;
  }
  consume(event);
  if (c.d.navigationLocked) {
    return true;
  }
  const { zoom, screenScale } = c.ui;
  const key = event.key.toLowerCase();
  if (event.key === "?") {
    c.openShortcuts();
  } else if (event.key === "+" || event.key === "=") {
    zoomAt(c, zoom * 1.25);
  } else if (event.key === "-") {
    zoomAt(c, zoom / 1.25);
  } else if (event.key === "0") {
    zoomAt(c, zoom / screenScale);
  } else if (key === "f") {
    if (event.shiftKey) {
      fitSelection(c);
    } else {
      fit(c);
    }
  } else if (key === "h") {
    c.ui.setPanTool((v) => !v);
  } else {
    cancelGesture(c.ui);
    c.ui.setPeekOriginal(true);
  }
  return true;
};

/** Pans the image (the panel's camera, or this canvas' own view) while Space is held. */
function panWithArrow(c: CanvasContext, key: string): void {
  const panel = panelView(c);
  if (panel) {
    const delta = panKeyDelta(key, 20);
    panel.panBy(delta.x, delta.y);
    return;
  }
  const step = 20 / (c.ui.screenScale / c.ui.zoom);
  const p = c.ui.view.current.pan;
  const delta = panKeyDelta(key, step);
  const next = { x: p.x + delta.x, y: p.y + delta.y };
  c.ui.view.current = { ...c.ui.view.current, pan: next };
  c.ui.setPan(next);
}

/**
 * Arrows belong to the canvas only to pan (with Space) or to nudge selected points. Otherwise ←/→
 * step the editing camera's frames: let them reach the playback shortcuts.
 */
const arrowKey: KeyHandler = (c, event) => {
  if (!event.key.startsWith("Arrow")) {
    return false;
  }
  const { peekOriginal, space } = c.ui;
  if (!peekOriginal && !space.current && c.d.selectedEditable.length === 0) {
    return true;
  }
  consume(event);
  if (peekOriginal) {
    return true;
  }
  if (space.current && !c.d.navigationLocked) {
    panWithArrow(c, event.key);
  } else if (c.d.selectedEditable.length > 0) {
    // Selected points move directly; no separate "point editing" step is needed.
    nudge(c, event.key, event.shiftKey ? 10 : 1);
  }
  return true;
};

const enterKey: KeyHandler = (c, event) => {
  if (event.key !== "Enter") {
    return false;
  }
  if (c.ui.peekOriginal) {
    consume(event);
    return true;
  }
  consume(event);
  if (c.d.drawing) {
    finishDrawing(c);
  } else if (c.state.editing) {
    // Enter confirms the edit. Every change is already staged, so this leaves edit mode.
    if (!c.d.locked) {
      run(c, () => {
        c.state.setEditing(false);
      });
      c.ui.setSelectedVertices([]);
    }
  } else {
    enterEditMode(c);
  }
  return true;
};

const deleteKey: KeyHandler = (c, event) => {
  if ((event.key !== "Delete" && event.key !== "Backspace") || c.d.locked) {
    return false;
  }
  consume(event);
  const { drawing, quickMode, selectedEditable } = c.d;
  if (drawing && quickMode) {
    requestQuickMask(c, c.ui.quickPoints.slice(0, -1));
  } else if (!drawing && c.state.editing && !c.ui.panTool && !c.ui.peekOriginal) {
    if (selectedEditable.length > 0) {
      removeVertices(c, selectedEditable, c.ui.preview);
    }
  }
  return true;
};

const escapeKey: KeyHandler = (c, event) => {
  if (event.key !== "Escape" || c.d.locked) {
    return false;
  }
  consume(event);
  const { ui } = c;
  if (ui.selectedVertices.length > 0 && !c.d.drawing) {
    ui.setSelectedVertices([]);
    return true;
  }
  ui.setDraft([]);
  ui.setPreview(undefined);
  ui.setMarquee(undefined);
  ui.setStroke(undefined);
  ui.previewRef.current = undefined;
  ui.drag.current = undefined;
  ui.setPanning(false);
  c.state.cancelDrawing();
  ui.setError(undefined);
  return true;
};

/** In order: the first handler that claims a key stops the rest. */
const KEY_HANDLERS: readonly KeyHandler[] = [
  contextMenuKey,
  spaceKey,
  undoKey,
  redoKey,
  modifiedKey,
  creationToolKey,
  brushKey,
  viewKey,
  arrowKey,
  enterKey,
  deleteKey,
  escapeKey,
];

/** Keyboard shortcuts of the canvas, for keys pressed on it (not inside dialogs or menus). */
export function handleKeyDown(c: CanvasContext, event: KeyEvent): void {
  if (
    !isAnnotationCanvasTarget(event.target) ||
    (event.target instanceof Element && event.target.closest("[role=dialog],[role=menu]"))
  ) {
    return;
  }
  for (const handler of KEY_HANDLERS) {
    if (handler(c, event)) {
      return;
    }
  }
}

/** Releasing Space ends the temporary pan; releasing O ends the original-image peek. */
export function handleKeyUp(c: CanvasContext, event: KeyEvent): void {
  if (!isAnnotationCanvasTarget(event.target)) {
    return;
  }
  if (event.key === " ") {
    consume(event);
    c.ui.space.current = false;
    c.ui.setSpaceHeld(false);
    if (c.ui.drag.current?.type === "pan" && c.ui.drag.current.temporarySpace) {
      cancelGesture(c.ui);
    }
  }
  if (event.key.toLowerCase() === "o") {
    c.ui.setPeekOriginal(false);
  }
}
