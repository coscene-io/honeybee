// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useLayoutEffect } from "react";

import { useStableCallback } from "../useStableCallback";
import { cancelGesture, commitPolygonPreview, resetTemporaryInput } from "./canvasActions";
import type { CanvasContext } from "./canvasUi";

/** Callbacks with a stable identity, for effects that must not re-run when state changes. */
function useGestureCallbacks(c: CanvasContext) {
  const cancel = useStableCallback(() => {
    cancelGesture(c.ui);
  });
  const reset = useStableCallback(() => {
    resetTemporaryInput(c.ui);
  });
  const commit = useStableCallback(() => {
    commitPolygonPreview(c.store, c.ui);
  });
  return { cancel, reset, commit };
}

/** Image size, the mask layer's opacity and the screen scale of the image. */
function useViewEffects(c: CanvasContext): void {
  const { ui, d, host } = c;
  const { nativeView } = d;
  const { setSize, setScreenScale, content, viewport, zoom, size } = ui;
  useLayoutEffect(() => {
    if (nativeView) {
      setSize({ width: nativeView.imageWidth, height: nativeView.imageHeight });
    }
  }, [nativeView, setSize]);
  useEffect(() => {
    // The GPU mask layer mirrors this canvas's overlay opacity and "peek original" hold.
    host.maskOverlayControls.setState({ opacity: ui.opacity, peekOriginal: ui.peekOriginal });
  }, [host, ui.opacity, ui.peekOriginal]);
  useLayoutEffect(() => {
    const updateScale = () => {
      const matrix =
        typeof content.current?.getScreenCTM === "function"
          ? content.current.getScreenCTM()
          : undefined;
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      setScreenScale(Number.isFinite(scale) && scale > 0 ? scale : 1);
    };
    updateScale();
    if (typeof ResizeObserver === "undefined" || !viewport.current) {
      return;
    }
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport.current);
    return () => {
      observer.disconnect();
    };
    // Over the Image panel its own zoom/pan arrives as a new nativeView matrix, not `zoom`.
  }, [zoom, nativeView, size.width, size.height, viewport, content, setScreenScale]);
}

/** Drops quick-mask requests and brush strokes that no longer apply. */
function useDrawingEffects(c: CanvasContext): void {
  const { ui, d, store, host } = c;
  const { drawing, frameId, tool, brushActive, focusedInstanceId } = d;
  const { setQuickPoints, setQuickResult, setQuickBusy, quickRequest, setStroke, setBrushCursor } =
    ui;
  useEffect(() => {
    quickRequest.current?.abort();
    setQuickPoints([]);
    setQuickResult(undefined);
    setQuickBusy(false);
    return () => {
      quickRequest.current?.abort();
    };
  }, [drawing, frameId, tool, quickRequest, setQuickPoints, setQuickResult, setQuickBusy]);
  useEffect(() => {
    setStroke(undefined);
    setBrushCursor(undefined);
  }, [brushActive, frameId, focusedInstanceId, setStroke, setBrushCursor]);
  useEffect(() => {
    if (
      store.getState().drawing == undefined &&
      host.session.getState().strokeFrameId != undefined
    ) {
      host.session.setState({ strokeFrameId: undefined });
    }
  }, [drawing, store, host]);
}

/** Resets held keys, selection and drafts when the edit scope or the frame changes. */
function useScopeEffects(c: CanvasContext, reset: () => void): void {
  const { ui, d, state, store } = c;
  const { setSelectedVertices, setContextMenu, setDraft, setHover, setError } = ui;
  useEffect(() => {
    reset();
    setSelectedVertices([]);
    setContextMenu(undefined);
    // Geometry edits may clone focus; only a meaningful scope change resets keyboard mode.
  }, [
    reset,
    state.focus?.type,
    state.focus?.id,
    state.editing,
    state.viewMode,
    d.locked,
    d.navigationLocked,
    d.drawing,
    ui.panTool,
    setSelectedVertices,
    setContextMenu,
  ]);
  useEffect(() => {
    setDraft([]);
    reset();
    setSelectedVertices([]);
    setContextMenu(undefined);
    setHover(undefined);
    setError(undefined);
  }, [
    d.drawing,
    d.frameId,
    state.interactionResetVersion,
    store,
    reset,
    setDraft,
    setSelectedVertices,
    setContextMenu,
    setHover,
    setError,
  ]);
}

/** Back to the fitted view when the record, camera or image size changes. */
function useViewResetEffect(
  c: CanvasContext,
  callbacks: ReturnType<typeof useGestureCallbacks>,
): void {
  const { ui, d, store } = c;
  const { view, setZoom, setPan, size } = ui;
  const { commit, reset } = callbacks;
  useEffect(() => {
    view.current = { zoom: 1, pan: { x: 0, y: 0 } };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // Image onLoad often discovers real pixels after a fast drag started against the
    // 960×540 placeholder; keep the normalized preview rather than silently discarding it.
    commit();
    reset();
  }, [
    d.document?.record.id,
    d.frame?.videoId,
    size.width,
    size.height,
    store,
    commit,
    reset,
    view,
    setZoom,
    setPan,
  ]);
}

/** Window-level key release, blur and tab hide end held-key modes. */
function useTemporaryInputListeners(
  c: CanvasContext,
  callbacks: ReturnType<typeof useGestureCallbacks>,
): void {
  const { ui } = c;
  const { cancel, reset } = callbacks;
  const { space, setSpaceHeld, setPeekOriginal, drag } = ui;
  useEffect(() => {
    const visibility = () => {
      if (globalThis.document.hidden) {
        reset();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === " ") {
        space.current = false;
        setSpaceHeld(false);
        if (drag.current?.type === "pan" && drag.current.temporarySpace) {
          cancel();
        }
      }
      if (event.key.toLowerCase() === "o") {
        setPeekOriginal(false);
      }
    };
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", reset);
    globalThis.document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", reset);
      globalThis.document.removeEventListener("visibilitychange", visibility);
    };
  }, [cancel, reset, space, setSpaceHeld, setPeekOriginal, drag]);
}

/** Wheel over the overlay zooms the Image panel's camera underneath. */
function useWheelForwarding(c: CanvasContext): void {
  const { viewport } = c.ui;
  const { decodedFrame } = c.props;
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button,input,select,textarea,[data-testid=canvas-notices]")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      decodedFrame?.nativeCanvas?.dispatchEvent(new WheelEvent("wheel", event));
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element?.removeEventListener("wheel", wheel);
    };
  });
}

/** Every effect of the canvas, in the order the effects must run. */
export function useCanvasEffects(c: CanvasContext): void {
  const callbacks = useGestureCallbacks(c);
  useViewEffects(c);
  useDrawingEffects(c);
  useScopeEffects(c, callbacks.reset);
  useViewResetEffect(c, callbacks);
  useTemporaryInputListeners(c, callbacks);
  useWheelForwarding(c);
}
