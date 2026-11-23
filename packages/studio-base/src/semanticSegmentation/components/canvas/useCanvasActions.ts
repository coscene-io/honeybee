// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { openKeyboardShortcuts } from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";

import { useStableActions } from "../useStableCallback";
import type { ContextMenuActions } from "./CanvasContextMenu";
import type { NoticeActions } from "./CanvasNotices";
import type { ToolsActions } from "./CanvasToolsPanel";
import type { ShapeActions } from "./PolygonLayer";
import {
  doubleClickMask,
  doubleClickPolygon,
  finishDrawing,
  openPolygonConversion,
  resetTemporaryInput,
  run,
  switchTool,
} from "./canvasActions";
import { handleKeyDown, handleKeyUp } from "./canvasKeyboard";
import {
  handleLostPointerCapture,
  handlePointerDown,
  handlePointerDownCapture,
  handlePointerMove,
  handlePointerUp,
  handleViewportMouseDownCapture,
  handleViewportPointerDownCapture,
} from "./canvasPointer";
import type { CanvasContext } from "./canvasUi";
import { removeVertexAt, startShape } from "./vertexEditing";
import { fit, fitSelection, zoomAt } from "./viewControls";

type SvgPointer = ReactPointerEvent<SVGSVGElement>;

/** Handlers for the viewport and the SVG scene. */
type InputActions = {
  keyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  keyUp: (event: ReactKeyboardEvent<HTMLElement>) => void;
  viewportPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  viewportMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  viewportBlur: (event: ReactFocusEvent<HTMLElement>) => void;
  pointerLeave: () => void;
  doubleClickMask: (event: ReactMouseEvent<SVGSVGElement>) => void;
  pointerDownCapture: (event: SvgPointer) => void;
  pointerDown: (event: SvgPointer) => void;
  pointerMove: (event: SvgPointer) => void;
  pointerUp: (event: SvgPointer) => void;
  pointerCancel: () => void;
  lostPointerCapture: () => void;
};

type DialogActions = {
  closeConversion: () => void;
  confirmConversion: () => void;
};

export type CanvasActions = ToolsActions &
  NoticeActions &
  ShapeActions &
  ContextMenuActions &
  InputActions &
  DialogActions;

const focusViewport = (c: CanvasContext): void => {
  c.ui.viewport.current?.focus({ preventScroll: true });
};

function inputActions(c: CanvasContext): InputActions {
  return {
    keyDown: (event) => {
      handleKeyDown(c, event);
    },
    keyUp: (event) => {
      handleKeyUp(c, event);
    },
    viewportPointerDownCapture: (event) => {
      handleViewportPointerDownCapture(c, event);
    },
    viewportMouseDownCapture: (event) => {
      handleViewportMouseDownCapture(c, event);
    },
    viewportBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        resetTemporaryInput(c.ui);
      }
    },
    pointerLeave: () => {
      c.ui.setHover(undefined);
      c.ui.setBrushCursor(undefined);
    },
    doubleClickMask: (event) => {
      doubleClickMask(c, event);
    },
    pointerDownCapture: (event) => {
      handlePointerDownCapture(c, event);
    },
    pointerDown: (event) => {
      handlePointerDown(c, event);
    },
    pointerMove: (event) => {
      handlePointerMove(c, event);
    },
    pointerUp: (event) => {
      handlePointerUp(c, event);
    },
    pointerCancel: () => {
      resetTemporaryInput(c.ui);
    },
    lostPointerCapture: () => {
      handleLostPointerCapture(c);
    },
  };
}

function toolsActions(c: CanvasContext): ToolsActions {
  const { ui } = c;
  return {
    toggleTools: () => {
      ui.setToolsOpen((open) => !open);
    },
    closeTools: () => {
      ui.setToolsOpen(false);
      focusViewport(c);
    },
    zoomOut: () => {
      zoomAt(c, ui.zoom / 1.25);
    },
    zoomIn: () => {
      zoomAt(c, ui.zoom * 1.25);
    },
    fit: () => {
      fit(c);
    },
    fitSelection: () => {
      fitSelection(c);
    },
    actualSize: () => {
      zoomAt(c, ui.zoom / ui.screenScale);
    },
    togglePan: () => {
      ui.setPanTool((value) => !value);
    },
    setOpacity: ui.setOpacity,
    openShortcuts: () => {
      openKeyboardShortcuts();
    },
    refocusAfterClick: (event) => {
      if (
        event.detail > 0 &&
        event.target instanceof Element &&
        event.target.closest("button") != undefined &&
        event.target.closest("[data-keep-control-focus]") == undefined
      ) {
        focusViewport(c);
      }
    },
  };
}

function noticeActions(c: CanvasContext): NoticeActions {
  const { ui } = c;
  return {
    dismissError: () => {
      ui.setError(undefined);
    },
    dismissNotice: () => {
      ui.setNotice(undefined);
    },
    setHelp: ui.setShowHelp,
    switchTool: (tool) => {
      switchTool(c, tool);
      focusViewport(c);
    },
    setBrushMode: (mode) => {
      ui.setBrush((current) => ({ ...current, mode }));
      focusViewport(c);
    },
    setBrushRadius: (radius) => {
      ui.setBrush((current) => ({ ...current, radius }));
    },
    convertToPolygons: () => {
      if (c.d.focusedInstanceId != undefined) {
        openPolygonConversion(c, c.d.focusedInstanceId);
      }
    },
    convertToMask: () => {
      const instanceId = c.d.focusedInstanceId;
      if (instanceId != undefined) {
        run(c, () => {
          c.state.convertToMask(instanceId);
        });
      }
    },
  };
}

function shapeActions(c: CanvasContext): ShapeActions {
  const { ui } = c;
  return {
    startShape: (event, instanceId, polygonId, points, vertex) => {
      startShape(c, event, instanceId, polygonId, points, vertex);
    },
    doubleClickPolygon: (event, polygonId) => {
      doubleClickPolygon(c, event, polygonId);
    },
    hoverVertex: ui.setHover,
    leaveVertex: () => {
      ui.setHover(undefined);
    },
    focusVertex: (polygonId, vertex) => {
      ui.setSelectedVertices([{ polygonId, vertex }]);
      focusViewport(c);
    },
  };
}

function menuActions(c: CanvasContext): ContextMenuActions & DialogActions {
  const { ui, state } = c;
  const close = () => {
    ui.setContextMenu(undefined);
  };
  return {
    closeMenu: close,
    focusPolygon: () => {
      const target = ui.contextMenu?.target;
      if (!target) {
        return;
      }
      if (!c.d.drawing) {
        state.setFocus({ type: "polygon", id: target.polygonId });
      }
      state.setSelection([{ type: "polygon", id: target.polygonId }]);
      close();
    },
    deleteVertex: () => {
      const target = ui.contextMenu?.target;
      if (target?.type === "vertex" && !c.d.locked && state.editing && !c.d.drawing) {
        removeVertexAt(c, target.polygonId, target.points, target.vertex);
      }
      close();
    },
    menuFinishDrawing: () => {
      finishDrawing(c);
      close();
    },
    menuFit: () => {
      fit(c);
      close();
    },
    menuFitSelection: () => {
      fitSelection(c);
      close();
    },
    menuShortcuts: () => {
      openKeyboardShortcuts();
      close();
    },
    closeConversion: () => {
      ui.setConversion(undefined);
    },
    confirmConversion: () => {
      const target = ui.conversion;
      ui.setConversion(undefined);
      if (target) {
        run(c, () => {
          state.convertToPolygons(target.instanceId);
        });
      }
    },
  };
}

/**
 * Every handler the canvas hands to its children. The object keeps its identity across renders
 * and each member calls the latest closure, so memoized children skip renders that change nothing
 * they show.
 */
export function useCanvasActions(c: CanvasContext): CanvasActions {
  return useStableActions<CanvasActions>({
    ...inputActions(c),
    ...toolsActions(c),
    ...noticeActions(c),
    ...shapeActions(c),
    ...menuActions(c),
  });
}
