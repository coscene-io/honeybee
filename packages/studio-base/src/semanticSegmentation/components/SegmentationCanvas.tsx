// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { makeStyles } from "tss-react/mui";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { isAnnotationCanvasTarget } from "../annotationInput";
import { segmentationSession, type DecodedSegmentationFrame } from "../runtime";
import type { SemanticSegmentationStore } from "../types";
import {
  clampUnit,
  hasPolygonArea,
  nearestPolygonEdge,
  polygonPath,
  screenToNormalized,
  translatePolygon,
} from "./editorGeometry";
import type { EditorPoint } from "./editorGeometry";
import { useEditorText } from "./editorMessages";
import { beginPolygonEdit, findPolygonOwner, focusContains } from "./polygonEdit";

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    outline: "none",
    overflow: "hidden",
    position: "relative",
    "& circle:focus": { outline: "none" },
  },
  toolbar: { padding: theme.spacing(1), flexWrap: "wrap" },
  toolsPanel: {
    position: "absolute",
    right: theme.spacing(1.5),
    bottom: theme.spacing(7),
    zIndex: 6,
    width: 296,
    maxWidth: `calc(100% - ${theme.spacing(3)})`,
    padding: theme.spacing(1.5),
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    boxShadow: theme.shadows[8],
    // Three equal columns; each control names its own cell so the layout does not depend on order.
    "&&": {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: theme.spacing(1),
      alignItems: "center",
    },
    "& .MuiButton-root": {
      minWidth: 0,
      height: 30,
      padding: theme.spacing(0, 1),
      color: theme.palette.text.primary,
      border: `1px solid ${theme.palette.divider}`,
      backgroundColor: "transparent",
      textTransform: "none",
      whiteSpace: "nowrap",
      "&:hover": { backgroundColor: theme.palette.action.hover },
      "&[aria-pressed=true]": {
        backgroundColor: theme.palette.action.selected,
        borderColor: theme.palette.primary.main,
      },
      "&.Mui-disabled": { color: theme.palette.text.disabled },
    },
    "& .MuiTypography-root": { color: theme.palette.text.secondary },
    "& [data-tool=zoom-out]": { gridRow: 1, gridColumn: 1 },
    "& [data-tool=zoom-label]": { gridRow: 1, gridColumn: 2, textAlign: "center" },
    "& [data-tool=zoom-in]": { gridRow: 1, gridColumn: 3 },
    "& [data-tool=fit]": { gridRow: 2, gridColumn: 1 },
    "& [data-tool=fit-selection]": { gridRow: 2, gridColumn: 2 },
    "& [data-tool=actual]": { gridRow: 2, gridColumn: 3 },
    "& [data-tool=pan]": { gridRow: 3, gridColumn: 1 },
    "& [data-tool=shortcuts]": { gridRow: 3, gridColumn: 3 },
    "&& select": {
      gridRow: 4,
      gridColumn: "1 / -1",
      height: 30,
      padding: theme.spacing(0, 1),
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.background.default,
      color: theme.palette.text.primary,
      font: "inherit",
      fontSize: theme.typography.body2.fontSize,
    },
    "& [data-tool=opacity]": {
      gridRow: 5,
      gridColumn: "1 / -1",
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(1.5),
      color: theme.palette.text.secondary,
      fontSize: theme.typography.body2.fontSize,
      "& input": { flex: 1, minWidth: 0, accentColor: theme.palette.primary.main },
    },
    "& [data-tool=size]": {
      gridRow: 6,
      gridColumn: "1 / -1",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
    },
  },
  toolsFab: {
    position: "absolute",
    right: theme.spacing(1.5),
    bottom: theme.spacing(1.5),
    zIndex: 6,
    width: 40,
    height: 40,
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    boxShadow: theme.shadows[4],
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  shortcutList: {
    "& dt": { fontWeight: "bold", marginTop: theme.spacing(1) },
    "& dd": { marginLeft: 0 },
  },
  hiddenImage: { display: "none" },
  viewport: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.palette.background.default,
    "&&:focus-visible": { outline: "2px solid #82b4ff", outlineOffset: -2 },
  },
  notices: {
    position: "absolute",
    inset: `${theme.spacing(1)} ${theme.spacing(1)} auto`,
    zIndex: 2,
    maxHeight: `calc(100% - ${theme.spacing(2)})`,
    overflowY: "auto",
    alignItems: "flex-end",
    pointerEvents: "none",
    "& > *": { pointerEvents: "auto", maxWidth: "min(600px, 100%)" },
  },
  footer: {
    paddingInline: theme.spacing(1),
    flexShrink: 0,
    height: 20,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
}));

export type SegmentationCanvasProps = {
  store: StoreApi<SemanticSegmentationStore>;
  viewportRef?: RefObject<HTMLDivElement>;
  imageUrl?: string;
  disabled?: boolean;
  decodedFrame?: DecodedSegmentationFrame;
  onFrameRendered?: (frame: DecodedSegmentationFrame) => void;
  onFrameRenderError?: (frame: DecodedSegmentationFrame) => void;
  /** Hides the toolbar and hint footer; view tools open from one floating button instead. */
  compact?: boolean;
  /** Frame this canvas draws. Omitted canvases follow the store's current frame. */
  frameId?: string;
  /** Called when a pointer claims this canvas as the one that receives new edits. */
  onClaimFocus?: () => void;
};

type Drag =
  | {
      type: "pan";
      origin: EditorPoint;
      pan: EditorPoint;
      button: number;
      moved: boolean;
      temporarySpace: boolean;
    }
  | {
      type: "polygon";
      instanceId: string;
      polygonId: string;
      origin: EditorPoint;
      screenOrigin: EditorPoint;
      points: EditorPoint[];
      vertex?: number;
    }
  | {
      // Several selected vertices moving together by the same delta.
      type: "vertices";
      origin: EditorPoint;
      screenOrigin: EditorPoint;
      targets: VertexGroup[];
      // The vertex that was pressed; a click without movement collapses the selection to it.
      pressed: VertexRef;
    }
  | {
      // Rubber-band rectangle over empty canvas that selects the vertices it covers.
      type: "marquee";
      origin: EditorPoint;
      screenOrigin: EditorPoint;
      additive: boolean;
      moved: boolean;
    };

type VertexRef = { polygonId: string; vertex: number };
type VertexGroup = {
  instanceId: string;
  polygonId: string;
  points: EditorPoint[];
  indices: number[];
};
type Preview = Record<string, EditorPoint[]>;

/** Moves the given vertices by (dx, dy), shrinking the delta so none leaves the image. */
function moveVertices(
  points: EditorPoint[],
  indices: readonly number[],
  dx: number,
  dy: number,
): EditorPoint[] {
  return points.map((p, i) =>
    indices.includes(i) ? { x: clampUnit(p.x + dx), y: clampUnit(p.y + dy) } : p,
  );
}
function clampDelta(groups: readonly VertexGroup[], dx: number, dy: number) {
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const group of groups) {
    for (const index of group.indices) {
      const p = group.points[index];
      if (p) {
        minX = Math.max(minX, -p.x);
        maxX = Math.min(maxX, 1 - p.x);
        minY = Math.max(minY, -p.y);
        maxY = Math.min(maxY, 1 - p.y);
      }
    }
  }
  return {
    dx: Math.min(Math.max(dx, minX), Math.max(minX, maxX)),
    dy: Math.min(Math.max(dy, minY), Math.max(minY, maxY)),
  };
}

type PolygonTarget = {
  type: "polygon";
  instanceId: string;
  polygonId: string;
  points: EditorPoint[];
};

type HoverTarget = { instanceId: string; polygonId: string; points: EditorPoint[] } & (
  | { type: "vertex"; vertex: number }
  | { type: "edge"; after: number; point: EditorPoint }
);

export function SegmentationCanvas({
  store,
  viewportRef,
  imageUrl,
  disabled = false,
  decodedFrame,
  onFrameRendered,
  onFrameRenderError,
  compact = false,
  frameId: shownFrameId,
  onClaimFocus,
}: SegmentationCanvasProps): React.JSX.Element {
  const { classes } = useStyles();
  const state = useStore(store);
  const text = useEditorText();
  const root = useRef<HTMLDivElement>(ReactNull);
  const content = useRef<SVGGElement>(ReactNull);
  const localViewport = useRef<HTMLDivElement>(ReactNull);
  const viewport = viewportRef ?? localViewport;
  const drag = useRef<Drag>();
  const capture = useRef<{ element: SVGElement; pointerId: number }>();
  const [size, setSize] = useState({ width: 960, height: 540 });
  const [zoom, setZoom] = useState(1);
  const [screenScale, setScreenScale] = useState(1);
  const [hover, setHover] = useState<HoverTarget>();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panTool, setPanTool] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  // Selected vertices, oldest first; the last one is the "active" point (context menu, footer).
  const [selectedVertices, setSelectedVertices] = useState<VertexRef[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const activeVertex = selectedVertices.at(-1);
  const [marquee, setMarquee] = useState<{ a: EditorPoint; b: EditorPoint }>();
  const [peekOriginal, setPeekOriginal] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    keyboard?: boolean;
    target?: HoverTarget | PolygonTarget;
  }>();
  const [profile, setProfile] = useState<"mouse" | "trackpad">(() => {
    try {
      return localStorage.getItem("bombus.segmentation.navigation.v1") === "trackpad"
        ? "trackpad"
        : "mouse";
    } catch {
      return "mouse";
    }
  });
  const [opacity, setOpacity] = useState(0.35);
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  view.current = { zoom, pan };
  const previewRef = useRef<Preview>();
  const [draft, setDraft] = useState<EditorPoint[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [showHelp, setShowHelp] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState<string>();
  const [loadedFrame, setLoadedFrame] = useState<DecodedSegmentationFrame>();
  const imageKey = useRef({ frame: decodedFrame, value: 0 });
  if (imageKey.current.frame !== decodedFrame) {
    imageKey.current = { frame: decodedFrame, value: imageKey.current.value + 1 };
  }
  const activeFrameId = state.currentFrameId;
  const frameId = shownFrameId ?? activeFrameId;
  const frame = state.document?.frames.find((item) => item.id === frameId);
  const source = imageUrl ?? frame?.imageUrl;
  const strokeFrameId = useStore(segmentationSession, (session) => session.strokeFrameId);
  const draftElsewhere =
    shownFrameId != undefined && strokeFrameId != undefined && shownFrameId !== strokeFrameId;
  const navigationLocked = disabled || ["running", "stopping"].includes(state.propagation.status);
  const locked =
    disabled ||
    state.readonly ||
    draftElsewhere ||
    ["running", "stopping"].includes(state.propagation.status) ||
    !source ||
    imageError;
  const drawingId = state.drawingPolygonId;
  const document = state.document;

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
  }, [zoom, size.width, size.height, viewport]);

  const cancelGesture = useCallback((): void => {
    drag.current = undefined;
    previewRef.current = undefined;
    setPreview(undefined);
    setMarquee(undefined);
    setPanning(false);
    setHover(undefined);
    const captured = capture.current;
    capture.current = undefined;
    if (
      captured != undefined &&
      typeof captured.element.hasPointerCapture === "function" &&
      captured.element.hasPointerCapture(captured.pointerId)
    ) {
      captured.element.releasePointerCapture(captured.pointerId);
    }
  }, []);
  // Commit before environmental clears (image size discovery, lost capture). Intentional
  // cancels call cancelGesture first, so drag/preview are already empty here.
  const commitPolygonPreview = useCallback((): void => {
    const active = drag.current;
    const latest = previewRef.current;
    const current = store.getState();
    if (
      (active?.type !== "polygon" && active?.type !== "vertices") ||
      !latest ||
      current.readonly ||
      ["running", "stopping"].includes(current.propagation.status) ||
      !current.currentFrameId ||
      !current.editing
    ) {
      return;
    }
    const doc = current.document;
    const targets: VertexGroup[] =
      active.type === "polygon"
        ? [
            {
              instanceId: active.instanceId,
              polygonId: active.polygonId,
              points: active.points,
              indices: [],
            },
          ]
        : active.targets;
    if (
      !targets.every((target) =>
        focusContains(
          doc,
          current.focus,
          current.currentFrameId,
          target.instanceId,
          target.polygonId,
        ),
      )
    ) {
      return;
    }
    const changed = targets.filter((target) => {
      const next = latest[target.polygonId];
      return (
        next?.some((p, i) => p.x !== target.points[i]?.x || p.y !== target.points[i].y) === true
      );
    });
    if (changed.length === 0) {
      return;
    }
    try {
      if (changed.length === 1) {
        current.setPolygonPoints(changed[0]!.polygonId, latest[changed[0]!.polygonId]!);
      } else {
        // One undo step for a batch that spans several polygons.
        current.runTransaction("Move vertices", () => {
          for (const target of changed) {
            current.setPolygonPoints(target.polygonId, latest[target.polygonId]!);
          }
        });
      }
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
  }, [store]);
  const resetTemporaryInput = useCallback((): void => {
    cancelGesture();
    space.current = false;
    setSpaceHeld(false);
    setPeekOriginal(false);
  }, [cancelGesture]);
  useEffect(() => {
    resetTemporaryInput();
    setSelectedVertices([]);
    setContextMenu(undefined);
    if (navigationLocked) {
      setShortcutsOpen(false);
    }
    // Geometry edits may clone focus; only a meaningful scope change resets keyboard mode.
  }, [
    resetTemporaryInput,
    state.focus?.type,
    state.focus?.id,
    state.editing,
    state.viewMode,
    locked,
    navigationLocked,
    drawingId,
    panTool,
  ]);

  const presentationReady = decodedFrame != undefined && state.isFrameReady(decodedFrame.frameId);
  useLayoutEffect(() => {
    if (
      !decodedFrame ||
      loadedFrame !== decodedFrame ||
      decodedFrame.frameId !== frame?.id ||
      decodedFrame.imageUrl !== source ||
      !presentationReady ||
      decodedFrame.presentation?.signal.aborted === true
    ) {
      return;
    }
    // The image load and this layout effect establish matched pixels + committed overlay.
    // Two RAFs give that commit a rendering opportunity; this is not compositor acknowledgement.
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (decodedFrame.presentation?.signal.aborted !== true) {
          onFrameRendered?.(decodedFrame);
        }
      });
    });
    const cancel = () => {
      cancelAnimationFrame(first);
      if (second != undefined) {
        cancelAnimationFrame(second);
      }
    };
    decodedFrame.presentation?.signal.addEventListener("abort", cancel, { once: true });
    return () => {
      cancel();
      decodedFrame.presentation?.signal.removeEventListener("abort", cancel);
    };
  }, [
    decodedFrame,
    loadedFrame,
    frame?.id,
    source,
    document?.annotations,
    document?.instances,
    document?.classes,
    state.viewMode,
    state.focus,
    presentationReady,
    onFrameRendered,
  ]);

  useEffect(() => {
    setDraft([]);
    resetTemporaryInput();
    setSelectedVertices([]);
    setContextMenu(undefined);
    setHover(undefined);
    setError(undefined);
  }, [drawingId, frameId, state.interactionResetVersion, store, resetTemporaryInput]);
  useEffect(() => {
    if (
      store.getState().drawingPolygonId == undefined &&
      segmentationSession.getState().strokeFrameId != undefined
    ) {
      segmentationSession.setState({ strokeFrameId: undefined });
    }
  }, [drawingId, store]);
  useEffect(() => {
    setImageError(false);
  }, [source]);
  useEffect(() => {
    view.current = { zoom: 1, pan: { x: 0, y: 0 } };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // Image onLoad often discovers real pixels after a fast drag started against the
    // 960×540 placeholder; keep the normalized preview rather than silently discarding it.
    commitPolygonPreview();
    resetTemporaryInput();
  }, [
    document?.record.id,
    frame?.videoId,
    size.width,
    size.height,
    commitPolygonPreview,
    resetTemporaryInput,
  ]);
  useEffect(() => {
    const reset = () => {
      resetTemporaryInput();
    };
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
          cancelGesture();
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
  }, [cancelGesture, resetTemporaryInput]);
  function zoomAt(next: number, client?: EditorPoint): void {
    if (navigationLocked) {
      return;
    }
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    cancelGesture();
    const current = view.current;
    const anchor = point(
      client
        ? { clientX: client.x, clientY: client.y }
        : { clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 },
    );
    // Always allow actual pixel size for both large and tiny source images.
    const actualSizeZoom = current.zoom / screenScale;
    const nextZoom = Math.max(
      Math.min(0.1, actualSizeZoom),
      Math.min(Math.max(32, actualSizeZoom), next),
    );
    if (!anchor) {
      return;
    }
    const nextPan = {
      x: current.pan.x + anchor.x * size.width * (current.zoom - nextZoom),
      y: current.pan.y + anchor.y * size.height * (current.zoom - nextZoom),
    };
    view.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
    setHover(undefined);
  }
  function fit(): void {
    if (navigationLocked) {
      return;
    }
    cancelGesture();
    view.current = { zoom: 1, pan: { x: 0, y: 0 } };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setHover(undefined);
  }
  function fitSelection(): void {
    if (navigationLocked) {
      return;
    }
    cancelGesture();
    const points = Object.values(document?.annotations ?? {})
      .filter((a) => a.frameId === frameId)
      .flatMap((a) =>
        a.polygons.filter((p) => inFocus(a.instanceId, p.id)).flatMap((p) => p.points),
      );
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds || points.length === 0) {
      return;
    }
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      top = Math.min(...ys),
      bottom = Math.max(...ys);
    const baseScale = screenScale / zoom;
    const nextZoom = Math.max(
      0.1,
      Math.min(
        32,
        0.85 *
          Math.min(
            bounds.width / (Math.max(0.001, right - left) * size.width * baseScale),
            bounds.height / (Math.max(0.001, bottom - top) * size.height * baseScale),
          ),
      ),
    );
    const nextPan = {
      x: size.width / 2 - ((left + right) / 2) * size.width * nextZoom,
      y: size.height / 2 - ((top + bottom) / 2) * size.height * nextZoom,
    };
    view.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  }
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
      if (navigationLocked) {
        return;
      }
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (element?.clientHeight ?? 400) : 1;
      if (profile === "mouse" || event.ctrlKey || event.metaKey) {
        zoomAt(
          view.current.zoom * Math.exp(-Math.max(-240, Math.min(240, event.deltaY * unit)) * 0.003),
          { x: event.clientX, y: event.clientY },
        );
      } else {
        cancelGesture();
        const outerScale = screenScale / zoom;
        const next = {
          x: view.current.pan.x - (event.deltaX * unit) / outerScale,
          y: view.current.pan.y - (event.deltaY * unit) / outerScale,
        };
        view.current = { ...view.current, pan: next };
        setPan(next);
      }
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element?.removeEventListener("wheel", wheel);
    };
  });

  function point(event: { clientX: number; clientY: number }): EditorPoint | undefined {
    const matrix = content.current?.getScreenCTM();
    return matrix
      ? screenToNormalized({ x: event.clientX, y: event.clientY }, matrix, size.width, size.height)
      : undefined;
  }
  function run(action: () => void): void {
    try {
      action();
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
  }
  function inFocus(instanceId: string, polygonId: string): boolean {
    return focusContains(document, state.focus, frameId, instanceId, polygonId);
  }
  function claimShownFrame(): boolean {
    if (draftElsewhere || shownFrameId == undefined || shownFrameId === activeFrameId) {
      return !draftElsewhere;
    }
    const live = store.getState();
    try {
      if (live.drawingPolygonId != undefined) {
        if (segmentationSession.getState().strokeFrameId != undefined) {
          return false;
        }
        live.retargetEmptyDrawing(shownFrameId);
      } else {
        live.setCurrentFrame(shownFrameId);
      }
    } catch (err) {
      setError(String(err));
      return false;
    }
    onClaimFocus?.();
    return true;
  }
  function startShape(
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    polygonId: string,
    points: EditorPoint[],
    vertex?: number,
  ): void {
    if (
      navigationLocked ||
      drawingId ||
      panTool ||
      space.current ||
      peekOriginal ||
      event.button !== 0
    ) {
      return;
    }
    claimShownFrame();
    event.stopPropagation();
    event.preventDefault();
    setHover(undefined);
    viewport.current?.focus({ preventScroll: true });
    const canEdit = !locked && state.editing && inFocus(instanceId, polygonId);
    const pressed: VertexRef | undefined = vertex == undefined ? undefined : { polygonId, vertex };
    state.setSelection([{ type: "polygon", id: polygonId }]);
    if (!canEdit) {
      if (pressed) {
        setSelectedVertices([pressed]);
      }
      state.setFocus({ type: "instance", id: instanceId });
      return;
    }
    if (pressed && event.shiftKey && !event.altKey) {
      // Shift+click adds/removes a point from the selection without starting a drag.
      setSelectedVertices((current) =>
        current.some((v) => v.polygonId === polygonId && v.vertex === vertex)
          ? current.filter((v) => v.polygonId !== polygonId || v.vertex !== vertex)
          : [...current, pressed],
      );
      return;
    }
    const grouped =
      pressed != undefined &&
      selectedEditable.length > 1 &&
      selectedEditable.some((v) => v.polygonId === polygonId && v.vertex === vertex);
    if (pressed && !grouped) {
      setSelectedVertices([pressed]);
    }
    if (event.altKey && vertex != undefined) {
      event.preventDefault();
      drag.current = undefined;
      setPreview(undefined);
      removeVertexAt(polygonId, points, vertex);
      return;
    }
    // Hovering/clicking a line inserts a point; grab the fill to drag the whole polygon.
    if (vertex == undefined) {
      const edge = hitTarget(event);
      if (edge?.type === "edge" && edge.polygonId === polygonId) {
        insertVertex(event, instanceId, polygonId, points);
        return;
      }
    }
    const origin = point(event);
    if (!origin) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    capture.current = { element: event.currentTarget, pointerId: event.pointerId };
    const screenOrigin = { x: event.clientX, y: event.clientY };
    drag.current = grouped
      ? { type: "vertices", origin, screenOrigin, targets: selectedGroups(), pressed }
      : { type: "polygon", instanceId, polygonId, origin, screenOrigin, points, vertex };
  }
  function hitTarget(event: { clientX: number; clientY: number }): HoverTarget | undefined {
    if (
      locked ||
      !state.editing ||
      drawingId ||
      panTool ||
      space.current ||
      peekOriginal ||
      state.viewMode === "original"
    ) {
      return undefined;
    }
    const matrix = content.current?.getScreenCTM();
    if (!matrix) {
      return undefined;
    }
    const targets = Object.values(document?.annotations ?? {})
      .filter((annotation) => annotation.frameId === frameId)
      .flatMap((annotation) =>
        annotation.polygons
          .filter((polygon) => inFocus(annotation.instanceId, polygon.id))
          .map((polygon) => ({
            instanceId: annotation.instanceId,
            polygonId: polygon.id,
            points: polygon.points,
          })),
      )
      .reverse();
    // Prioritize the forgiving vertex hit area over an adjacent insertion edge.
    for (const target of targets) {
      for (const [vertex, p] of target.points.entries()) {
        const x = matrix.a * p.x * size.width + matrix.c * p.y * size.height + matrix.e;
        const y = matrix.b * p.x * size.width + matrix.d * p.y * size.height + matrix.f;
        if (Math.hypot(event.clientX - x, event.clientY - y) <= 8) {
          return { ...target, type: "vertex", vertex };
        }
      }
    }
    for (const target of targets) {
      const edge = nearestPolygonEdge(
        { x: event.clientX, y: event.clientY },
        target.points,
        matrix,
        size.width,
        size.height,
      );
      if (edge) {
        return { ...target, type: "edge", ...edge };
      }
    }
    return undefined;
  }
  function contextTarget(event: {
    clientX: number;
    clientY: number;
  }): HoverTarget | PolygonTarget | undefined {
    if (drawingId) {
      return undefined;
    }
    const nearby = hitTarget(event);
    if (nearby) {
      return nearby;
    }
    if (drawingId || peekOriginal || state.viewMode === "original") {
      return undefined;
    }
    const location = point(event);
    if (!location) {
      return undefined;
    }
    const polygons = Object.values(document?.annotations ?? {})
      .filter((a) => a.frameId === frameId)
      .flatMap((a) =>
        a.polygons
          .filter((p) => state.viewMode === "all" || inFocus(a.instanceId, p.id))
          .map((p) => ({
            type: "polygon" as const,
            instanceId: a.instanceId,
            polygonId: p.id,
            points: p.points,
          })),
      )
      .reverse();
    return polygons.find(({ points }) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!,
          b = points[j]!;
        if (
          a.y > location.y !== b.y > location.y &&
          location.x < ((b.x - a.x) * (location.y - a.y)) / (b.y - a.y) + a.x
        ) {
          inside = !inside;
        }
      }
      return inside;
    });
  }
  function removeVertexAt(polygonId: string, points: EditorPoint[], vertex: number): void {
    removeVertices([{ polygonId, vertex }], { [polygonId]: points });
  }
  /** Deletes the given vertices; every affected polygon must keep at least 3 (all-or-nothing). */
  function removeVertices(refs: VertexRef[], known?: Preview): void {
    const groups = new Map<string, Set<number>>();
    for (const ref of refs) {
      groups.set(ref.polygonId, (groups.get(ref.polygonId) ?? new Set()).add(ref.vertex));
    }
    const edits: { polygonId: string; kept: EditorPoint[]; first: number }[] = [];
    for (const [polygonId, indices] of groups) {
      const points = known?.[polygonId] ?? vertices.find((v) => v.polygonId === polygonId)?.points;
      if (!points) {
        continue;
      }
      const kept = points.filter((_point, index) => !indices.has(index));
      if (kept.length < 3) {
        setError(text("A polygon must keep at least 3 vertices.", "多边形必须保留至少 3 个顶点。"));
        return;
      }
      edits.push({ polygonId, kept, first: Math.min(...indices) });
    }
    const last = edits.at(-1);
    if (!last) {
      return;
    }
    run(() => {
      const apply = (): undefined => {
        for (const edit of edits) {
          state.setPolygonPoints(edit.polygonId, edit.kept);
        }
      };
      if (edits.length > 1) {
        state.runTransaction("Delete vertices", apply);
      } else {
        apply();
      }
      setSelectedVertices([
        { polygonId: last.polygonId, vertex: Math.min(last.first, last.kept.length - 1) },
      ]);
    });
  }
  function insertVertex(
    event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>,
    instanceId: string,
    polygonId: string,
    points: EditorPoint[],
  ): void {
    event.stopPropagation();
    if (
      locked ||
      !state.editing ||
      !inFocus(instanceId, polygonId) ||
      drawingId ||
      panTool ||
      event.button !== 0
    ) {
      return;
    }
    const edge = hitTarget(event);
    if (edge?.type !== "edge" || edge.polygonId !== polygonId) {
      return;
    }
    event.preventDefault();
    setHover(undefined);
    drag.current = undefined;
    setPreview(undefined);
    run(() => {
      state.setPolygonPoints(polygonId, [
        ...points.slice(0, edge.after + 1),
        edge.point,
        ...points.slice(edge.after + 1),
      ]);
      setSelectedVertices([{ polygonId, vertex: edge.after + 1 }]);
    });
  }
  function finishDrawing(): void {
    if (!drawingId || locked || !frameId) {
      return;
    }
    if (draft.length < 3) {
      setError(
        text(
          "Add at least 3 vertices before pressing Enter.",
          "请添加至少 3 个顶点后按 Enter 完成。",
        ),
      );
      return;
    }
    if (!hasPolygonArea(draft)) {
      setError(
        text("Vertices must enclose a nonzero area.", "顶点必须围成非零面积，请调整后重试。"),
      );
      return;
    }
    const annotation = Object.values(document?.annotations ?? {}).find(
      (item) =>
        item.frameId === frameId && item.polygons.some((polygon) => polygon.id === drawingId),
    );
    if (!annotation) {
      setError("The drawing target is no longer available.");
      return;
    }
    run(() => {
      state.setPolygonPoints(drawingId, draft);
      state.setDrawingPolygonId(undefined);
    });
  }

  const vertices =
    !locked && state.editing && !drawingId && state.viewMode !== "original"
      ? Object.values(document?.annotations ?? {})
          .filter((a) => a.frameId === frameId)
          .flatMap((a) =>
            a.polygons
              .filter((p) => inFocus(a.instanceId, p.id))
              .flatMap((p) =>
                p.points.map((pnt, vertex) => ({
                  instanceId: a.instanceId,
                  polygonId: p.id,
                  vertex,
                  point: pnt,
                  points: p.points,
                })),
              ),
          )
      : [];
  const activePoint = vertices.find(
    (v) => v.polygonId === activeVertex?.polygonId && v.vertex === activeVertex.vertex,
  );
  /** Selects every editable vertex inside the rectangle (normalized coordinates). */
  function selectInRect(a: EditorPoint, b: EditorPoint, options: { additive: boolean }): void {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const hits = vertices
      .filter((v) => v.point.x >= x0 && v.point.x <= x1 && v.point.y >= y0 && v.point.y <= y1)
      .map((v) => ({ polygonId: v.polygonId, vertex: v.vertex }));
    setSelectedVertices((current) =>
      options.additive
        ? [
            ...current,
            ...hits.filter(
              (hit) =>
                !current.some((c) => c.polygonId === hit.polygonId && c.vertex === hit.vertex),
            ),
          ]
        : hits,
    );
  }
  /** Double-clicking a polygon edits it. */
  function doubleClickPolygon(event: ReactMouseEvent<SVGElement>, polygonId: string): void {
    if (locked || navigationLocked || drawingId || panTool || peekOriginal || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    run(() => {
      beginPolygonEdit(state, polygonId);
    });
  }
  /** Enter on a selected polygon: start editing it (or drawing it, when it has no vertices yet). */
  function enterEditMode(): void {
    if (locked) {
      return;
    }
    const polygonId =
      state.selection.find(
        (node) =>
          node.type === "polygon" && findPolygonOwner(document, frameId, node.id) != undefined,
      )?.id ?? (state.focus?.type === "polygon" ? state.focus.id : undefined);
    if (polygonId) {
      run(() => {
        beginPolygonEdit(state, polygonId);
      });
    }
  }

  // Vertices that are selected and still editable; everything below acts on these.
  const selectedEditable = selectedVertices.filter((ref) =>
    vertices.some((v) => v.polygonId === ref.polygonId && v.vertex === ref.vertex),
  );
  function selectedGroups(): VertexGroup[] {
    const groups = new Map<string, VertexGroup>();
    for (const ref of selectedEditable) {
      const owner = vertices.find((v) => v.polygonId === ref.polygonId);
      if (owner) {
        const group = groups.get(ref.polygonId) ?? {
          instanceId: owner.instanceId,
          polygonId: ref.polygonId,
          points: owner.points,
          indices: [],
        };
        group.indices.push(ref.vertex);
        groups.set(ref.polygonId, group);
      }
    }
    return [...groups.values()];
  }
  function nudge(key: string, step: 1 | 10): void {
    if (locked) {
      return;
    }
    const groups = selectedGroups();
    const rawX =
      key === "ArrowRight" ? step / size.width : key === "ArrowLeft" ? -step / size.width : 0;
    const rawY =
      key === "ArrowDown" ? step / size.height : key === "ArrowUp" ? -step / size.height : 0;
    const { dx, dy } = clampDelta(groups, rawX, rawY);
    if (groups.length === 0 || (dx === 0 && dy === 0)) {
      return;
    }
    run(() => {
      const apply = (): undefined => {
        for (const group of groups) {
          state.setPolygonPoints(
            group.polygonId,
            moveVertices(group.points, group.indices, dx, dy),
          );
        }
      };
      if (groups.length > 1) {
        state.runTransaction("Move vertices", apply);
      } else {
        apply();
      }
    });
  }

  return (
    <Stack
      ref={root}
      tabIndex={-1}
      aria-label="Segmentation canvas"
      data-segmentation-input="canvas"
      className={classes.root}
      onKeyDown={(event) => {
        if (
          !isAnnotationCanvasTarget(event.target) ||
          (event.target instanceof Element && event.target.closest("[role=dialog],[role=menu]"))
        ) {
          return;
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          if (!navigationLocked) {
            const bounds = viewport.current?.getBoundingClientRect();
            if (bounds) {
              const target =
                activePoint && !peekOriginal && !panTool && !space.current
                  ? { type: "vertex" as const, ...activePoint }
                  : undefined;
              const matrix = target ? content.current?.getScreenCTM() : undefined;
              setContextMenu({
                x:
                  target && matrix
                    ? matrix.a * target.point.x * size.width +
                      matrix.c * target.point.y * size.height +
                      matrix.e
                    : bounds.x + bounds.width / 2,
                y:
                  target && matrix
                    ? matrix.b * target.point.x * size.width +
                      matrix.d * target.point.y * size.height +
                      matrix.f
                    : bounds.y + bounds.height / 2,
                keyboard: true,
                target,
              });
            }
          }
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (!navigationLocked && !event.repeat) {
            cancelGesture();
            space.current = true;
            setSpaceHeld(true);
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.stopPropagation();
          if (
            !locked &&
            (event.shiftKey ? store.getState().canRedo : state.stagedOperations.length > 0)
          ) {
            run(() => {
              if (event.shiftKey) {
                store.getState().redo();
              } else {
                store.getState().undo();
              }
            });
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
          event.preventDefault();
          event.stopPropagation();
          if (!locked && store.getState().canRedo) {
            run(() => {
              store.getState().redo();
            });
          }
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        if (["+", "=", "-", "f", "F", "0", "h", "H", "?", "o", "O"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (navigationLocked) {
            return;
          }
          if (event.key === "?") {
            setShortcutsOpen(true);
            return;
          }
          if (event.key === "+" || event.key === "=") {
            zoomAt(zoom * 1.25);
          } else if (event.key === "-") {
            zoomAt(zoom / 1.25);
          } else if (event.key === "0") {
            zoomAt(zoom / screenScale);
          } else if (event.key.toLowerCase() === "f") {
            if (event.shiftKey) {
              fitSelection();
            } else {
              fit();
            }
          } else if (event.key.toLowerCase() === "h") {
            setPanTool((v) => !v);
          } else {
            cancelGesture();
            setPeekOriginal(true);
          }
          return;
        }
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          event.stopPropagation();
          if (peekOriginal) {
            return;
          }
          if (space.current && !navigationLocked) {
            const step = 20 / (screenScale / zoom);
            const p = view.current.pan;
            const next = {
              x: p.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
              y: p.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
            };
            view.current = { ...view.current, pan: next };
            setPan(next);
          } else if (selectedEditable.length > 0) {
            // Selected points move directly; no separate "point editing" step is needed.
            nudge(event.key, event.shiftKey ? 10 : 1);
          }
          return;
        }
        if (event.key === "Enter") {
          if (peekOriginal) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (drawingId) {
            event.preventDefault();
            event.stopPropagation();
            finishDrawing();
          } else if (state.editing) {
            // Enter confirms the edit. Every change is already staged, so this leaves edit mode.
            event.preventDefault();
            event.stopPropagation();
            if (!locked) {
              run(() => {
                state.setEditing(false);
              });
              setSelectedVertices([]);
            }
          } else {
            event.preventDefault();
            event.stopPropagation();
            enterEditMode();
          }
          return;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && !locked) {
          event.preventDefault();
          event.stopPropagation();
          if (drawingId || !state.editing || panTool || peekOriginal) {
            return;
          }
          if (selectedEditable.length > 0) {
            removeVertices(selectedEditable, preview);
          }
          return;
        }
        if (event.key === "Escape" && !locked) {
          event.preventDefault();
          event.stopPropagation();
          if (selectedVertices.length > 0 && !drawingId) {
            setSelectedVertices([]);
            return;
          }
          setDraft([]);
          setPreview(undefined);
          setMarquee(undefined);
          previewRef.current = undefined;
          drag.current = undefined;
          setPanning(false);
          state.setDrawingPolygonId(undefined);
          setError(undefined);
        }
      }}
      onKeyUp={(event) => {
        if (!isAnnotationCanvasTarget(event.target)) {
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          space.current = false;
          setSpaceHeld(false);
          if (drag.current?.type === "pan" && drag.current.temporarySpace) {
            cancelGesture();
          }
        }
        if (event.key.toLowerCase() === "o") {
          setPeekOriginal(false);
        }
      }}
    >
      {(!compact || toolsOpen) && (
        <Stack
          direction="row"
          spacing={compact ? 0 : 0.5}
          alignItems="center"
          className={compact ? classes.toolsPanel : classes.toolbar}
          role={compact ? "group" : undefined}
          aria-label={compact ? text("View tools", "视图工具") : undefined}
          onKeyDown={(event) => {
            if (compact && event.key === "Escape") {
              event.stopPropagation();
              setToolsOpen(false);
              viewport.current?.focus({ preventScroll: true });
            }
          }}
          onClick={(event) => {
            if (
              event.detail > 0 &&
              event.target instanceof Element &&
              event.target.closest("button") != undefined &&
              event.target.closest("[data-keep-control-focus]") == undefined
            ) {
              viewport.current?.focus({ preventScroll: true });
            }
          }}
        >
          <Button
            size="small"
            disabled={navigationLocked}
            aria-label="Zoom out"
            data-tool="zoom-out"
            onClick={() => {
              zoomAt(zoom / 1.25);
            }}
          >
            −
          </Button>
          <Typography variant="caption" aria-live="polite" data-tool="zoom-label">
            {zoom === 1 && pan.x === 0 && pan.y === 0 ? "Fit · " : ""}
            {Math.round(screenScale * 100)}%
          </Typography>
          <Button
            size="small"
            disabled={navigationLocked}
            aria-label="Zoom in"
            data-tool="zoom-in"
            onClick={() => {
              zoomAt(zoom * 1.25);
            }}
          >
            +
          </Button>
          <Button
            size="small"
            data-tool="fit"
            disabled={navigationLocked}
            onClick={() => {
              fit();
            }}
          >
            {text("Fit", "适应画布")}
          </Button>
          <Button
            size="small"
            data-tool="actual"
            disabled={navigationLocked}
            onClick={() => {
              zoomAt(zoom / screenScale);
            }}
          >
            100%
          </Button>
          <Button
            size="small"
            data-tool="fit-selection"
            disabled={navigationLocked || !state.focus}
            onClick={fitSelection}
          >
            {text("Fit selection", "适应选区")}
          </Button>
          <Button
            size="small"
            disabled={navigationLocked}
            aria-pressed={panTool}
            data-tool="pan"
            onClick={() => {
              setPanTool((value) => !value);
            }}
          >
            {text("Pan", "平移")}
          </Button>
          <Typography variant="caption" data-tool="size">
            {size.width} × {size.height}
          </Typography>
          <select
            aria-label="Navigation profile"
            data-tool="profile"
            disabled={navigationLocked}
            value={profile}
            onChange={(event) => {
              const next = event.target.value === "trackpad" ? "trackpad" : "mouse";
              setProfile(next);
              try {
                localStorage.setItem("bombus.segmentation.navigation.v1", next);
              } catch {
                /* Navigation remains usable without local persistence. */
              }
            }}
          >
            <option value="mouse">{text("Mouse: wheel zoom", "鼠标：滚轮缩放")}</option>
            <option value="trackpad">{text("Trackpad: scroll pan", "触控板：滑动平移")}</option>
          </select>
          <label data-tool="opacity">
            {text("Opacity", "透明度")}{" "}
            <input
              aria-label="Overlay opacity"
              disabled={navigationLocked}
              type="range"
              min={0}
              max={0.7}
              step={0.05}
              value={opacity}
              style={compact ? undefined : { width: 70 }}
              onChange={(event) => {
                setOpacity(Number(event.target.value));
              }}
            />
          </label>
          <Button
            size="small"
            data-keep-control-focus
            data-tool="shortcuts"
            disabled={navigationLocked}
            onClick={() => {
              setShortcutsOpen(true);
            }}
          >
            {text("Shortcuts", "快捷键")}
          </Button>
        </Stack>
      )}
      {compact && (
        <IconButton
          className={classes.toolsFab}
          size="small"
          aria-label={text("View tools", "视图工具")}
          aria-expanded={toolsOpen}
          onClick={() => {
            setToolsOpen((open) => !open);
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </IconButton>
      )}
      <Box
        ref={viewport}
        className={classes.viewport}
        data-testid="segmentation-viewport"
        tabIndex={0}
        role="group"
        aria-label="Annotation viewport"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            resetTemporaryInput();
          }
        }}
      >
        <Stack className={classes.notices} spacing={1} data-testid="canvas-notices">
          {draftElsewhere && (
            <Alert severity="info" role="status">
              {text(
                "Finish the polygon on the other canvas before drawing here.",
                "这一笔还在另一路画布上，完成后再标注这里。",
              )}
            </Alert>
          )}
          {error && (
            <Alert
              severity="error"
              onClose={() => {
                setError(undefined);
              }}
            >
              {error}
            </Alert>
          )}
          {drawingId && showHelp && !draftElsewhere && (
            <Alert
              severity="info"
              onClose={() => {
                setShowHelp(false);
              }}
            >
              {text(
                "Click to add vertices. Enter finishes with at least 3 points. Esc cancels the drawing and keeps the original polygon.",
                "依次点击添加顶点，至少 3 点后按 Enter 完成；按 Esc 取消本次绘制，保留原多边形。",
              )}
            </Alert>
          )}
          {drawingId && !showHelp && !draftElsewhere && (
            <Button
              size="small"
              onClick={() => {
                setShowHelp(true);
              }}
            >
              {text("Drawing help", "绘制帮助")}
            </Button>
          )}
          {!source || imageError ? (
            <Alert severity={imageError ? "error" : "info"}>
              {imageError
                ? text(
                    "The frame image could not be loaded. Choose another frame or retry.",
                    "当前帧图片加载失败，请切换帧或重试。",
                  )
                : text("Select a frame to start annotating.", "请选择帧以开始标注。")}
            </Alert>
          ) : (
            <Box
              component="img"
              src={source}
              alt=""
              className={classes.hiddenImage}
              onLoad={(event) => {
                setSize({
                  width:
                    event.currentTarget.naturalWidth > 0 ? event.currentTarget.naturalWidth : 960,
                  height:
                    event.currentTarget.naturalHeight > 0 ? event.currentTarget.naturalHeight : 540,
                });
              }}
              onError={() => {
                setImageError(true);
              }}
            />
          )}
        </Stack>
        <svg
          role="img"
          aria-label="Frame polygons"
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width} ${size.height}`}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            touchAction: "none",
            cursor: panning
              ? "grabbing"
              : panTool || spaceHeld
                ? "grab"
                : drawingId
                  ? "crosshair"
                  : hover?.type === "edge"
                    ? "copy"
                    : "default",
          }}
          onPointerLeave={() => {
            setHover(undefined);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDownCapture={(event) => {
            if (navigationLocked) {
              return;
            }
            if (
              event.button === 1 ||
              event.button === 2 ||
              ((panTool || space.current) && event.button === 0)
            ) {
              event.preventDefault();
              event.stopPropagation();
              viewport.current?.focus({ preventScroll: true });
              cancelGesture();
              event.currentTarget.setPointerCapture(event.pointerId);
              capture.current = { element: event.currentTarget, pointerId: event.pointerId };
              drag.current = {
                type: "pan",
                origin: { x: event.clientX, y: event.clientY },
                pan: view.current.pan,
                button: event.button,
                moved: false,
                temporarySpace: space.current && event.button === 0,
              };
              setPanning(true);
              setContextMenu(undefined);
              setHover(undefined);
            }
          }}
          onPointerDown={(event) => {
            setHover(undefined);
            viewport.current?.focus({ preventScroll: true });
            if (draftElsewhere || !claimShownFrame()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (navigationLocked) {
              return;
            }
            if (
              !drawingId &&
              !peekOriginal &&
              !locked &&
              !panTool &&
              !space.current &&
              state.viewMode !== "original" &&
              event.button === 0
            ) {
              const target = hitTarget(event);
              if (target?.type === "edge") {
                insertVertex(event, target.instanceId, target.polygonId, target.points);
                return;
              }
              // Dragging over empty canvas in edit mode draws a selection rectangle.
              const origin = state.editing ? point(event) : undefined;
              if (origin) {
                event.currentTarget.setPointerCapture(event.pointerId);
                capture.current = { element: event.currentTarget, pointerId: event.pointerId };
                drag.current = {
                  type: "marquee",
                  origin,
                  screenOrigin: { x: event.clientX, y: event.clientY },
                  additive: event.shiftKey,
                  moved: false,
                };
                return;
              }
            }
            if (
              drawingId &&
              !peekOriginal &&
              !locked &&
              state.viewMode !== "original" &&
              event.button === 0
            ) {
              const next = point(event);
              if (!next) {
                setError(
                  text(
                    "The pointer cannot be mapped to this frame. Use Fit and try again.",
                    "无法将落点映射到当前帧，请适应画布后重试。",
                  ),
                );
              } else {
                // The nearest point on the image rectangle is each axis clamped to [0, 1].
                const placed = { x: clampUnit(next.x), y: clampUnit(next.y) };
                setDraft((points) => [...points, placed]);
                if (segmentationSession.getState().strokeFrameId == undefined) {
                  segmentationSession.setState({ strokeFrameId: shownFrameId ?? frameId });
                }
                setError(undefined);
              }
            }
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active) {
              setHover(hitTarget(event));
              return;
            }
            if (active.type === "pan") {
              if (navigationLocked) {
                drag.current = undefined;
                setPanning(false);
                return;
              }
              if (
                Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < 4 &&
                !active.moved
              ) {
                return;
              }
              active.moved = true;
              const matrix = event.currentTarget.getScreenCTM();
              if (matrix) {
                const origin = screenToNormalized(active.origin, matrix, 1, 1);
                const current = screenToNormalized(
                  { x: event.clientX, y: event.clientY },
                  matrix,
                  1,
                  1,
                );
                if (origin && current) {
                  const nextPan = {
                    x: active.pan.x + current.x - origin.x,
                    y: active.pan.y + current.y - origin.y,
                  };
                  view.current = { ...view.current, pan: nextPan };
                  setPan(nextPan);
                }
              }
              return;
            }
            const travelled = Math.hypot(
              event.clientX - active.screenOrigin.x,
              event.clientY - active.screenOrigin.y,
            );
            if (active.type === "marquee") {
              if (!active.moved && travelled < 4) {
                return;
              }
              active.moved = true;
              const current = point(event);
              if (current) {
                setMarquee({ a: active.origin, b: current });
              }
              return;
            }
            if (travelled < 4) {
              previewRef.current = undefined;
              setPreview(undefined);
              return;
            }
            const next = point(event);
            const targets: VertexGroup[] =
              active.type === "vertices"
                ? active.targets
                : [
                    {
                      instanceId: active.instanceId,
                      polygonId: active.polygonId,
                      points: active.points,
                      indices: [],
                    },
                  ];
            if (
              !next ||
              locked ||
              !state.editing ||
              !targets.every((target) => inFocus(target.instanceId, target.polygonId))
            ) {
              cancelGesture();
              return;
            }
            let moved: Preview;
            if (active.type === "vertices") {
              const { dx, dy } = clampDelta(
                active.targets,
                next.x - active.origin.x,
                next.y - active.origin.y,
              );
              moved = Object.fromEntries(
                active.targets.map((t) => [t.polygonId, moveVertices(t.points, t.indices, dx, dy)]),
              );
            } else {
              moved = {
                [active.polygonId]:
                  active.vertex == undefined
                    ? translatePolygon(active.points, {
                        x: next.x - active.origin.x,
                        y: next.y - active.origin.y,
                      })
                    : active.points.map((old, index) =>
                        index === active.vertex
                          ? { x: clampUnit(next.x), y: clampUnit(next.y) }
                          : old,
                      ),
              };
            }
            previewRef.current = moved;
            setPreview(moved);
          }}
          onPointerUp={(event) => {
            const active = drag.current;
            if (
              active?.type === "pan" &&
              active.button === 2 &&
              !active.moved &&
              !navigationLocked
            ) {
              setContextMenu({ x: event.clientX, y: event.clientY, target: contextTarget(event) });
            }
            if (active?.type === "marquee") {
              const end = point(event);
              if (active.moved && end) {
                selectInRect(active.origin, end, { additive: active.additive });
              } else if (!active.moved && !active.additive) {
                setSelectedVertices([]);
              }
            } else if (active?.type === "vertices" && !previewRef.current) {
              // A plain click on one of several selected points keeps just that point.
              setSelectedVertices([active.pressed]);
            }
            commitPolygonPreview();
            cancelGesture();
          }}
          onPointerCancel={resetTemporaryInput}
          onLostPointerCapture={() => {
            if (drag.current) {
              // DOM remounts (late frame-window merge, viewBox resize) can drop capture
              // before pointerup; commit the preview instead of reverting the gesture.
              commitPolygonPreview();
              resetTemporaryInput();
            }
          }}
        >
          <g ref={content} transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {source && !imageError && (
              /* eslint-disable @coscene-io/link-target, react/no-unknown-property -- SVG image embeds pixels and supports its own load/error events. */
              <image
                key={decodedFrame ? imageKey.current.value : source}
                href={source}
                width={size.width}
                height={size.height}
                onLoad={() => {
                  setLoadedFrame(decodedFrame);
                }}
                onError={() => {
                  setImageError(true);
                  if (decodedFrame) {
                    onFrameRenderError?.(decodedFrame);
                  }
                }}
              />
              /* eslint-enable @coscene-io/link-target, react/no-unknown-property */
            )}
            {state.viewMode !== "original" &&
              !peekOriginal &&
              document?.instances.map((instance) => {
                const color =
                  document.classes.find((item) => item.id === instance.classId)?.color ?? "#00897b";
                const polygons =
                  Object.values(document.annotations).find(
                    (annotation) =>
                      annotation.frameId === frameId && annotation.instanceId === instance.id,
                  )?.polygons ?? [];
                const visible = polygons.filter(
                  (polygon) => state.viewMode === "all" || inFocus(instance.id, polygon.id),
                );
                return (
                  <g key={instance.id} data-instance-id={instance.id}>
                    <g opacity={opacity} fill={color} data-testid="instance-union-fill">
                      {visible.map((polygon) => (
                        <path
                          key={polygon.id}
                          d={polygonPath(
                            preview?.[polygon.id] ?? polygon.points,
                            size.width,
                            size.height,
                          )}
                          onPointerDown={(event) => {
                            startShape(event, instance.id, polygon.id, polygon.points);
                          }}
                          onDoubleClick={(event) => {
                            doubleClickPolygon(event, polygon.id);
                          }}
                        />
                      ))}
                    </g>
                    {visible.map((polygon) => {
                      const points = preview?.[polygon.id] ?? polygon.points;
                      const editable =
                        state.editing && inFocus(instance.id, polygon.id) && !locked && !drawingId;
                      return (
                        <g key={polygon.id}>
                          <path
                            d={polygonPath(points, size.width, size.height)}
                            fill="none"
                            stroke={color}
                            strokeWidth={inFocus(instance.id, polygon.id) ? 2 : 1}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="stroke"
                            onPointerDown={(event) => {
                              startShape(event, instance.id, polygon.id, polygon.points);
                            }}
                            onDoubleClick={(event) => {
                              doubleClickPolygon(event, polygon.id);
                            }}
                          />
                          {editable &&
                            points.map((vertex, index) => {
                              const selected = selectedVertices.some(
                                (v) => v.polygonId === polygon.id && v.vertex === index,
                              );
                              const highlighted =
                                (hover?.type === "vertex" &&
                                  hover.polygonId === polygon.id &&
                                  hover.vertex === index) ||
                                (drag.current?.type === "polygon" &&
                                  drag.current.polygonId === polygon.id &&
                                  drag.current.vertex === index);
                              return (
                                <g key={index}>
                                  <circle
                                    aria-label={`Vertex ${index + 1} of polygon ${polygon.id}`}
                                    role="button"
                                    tabIndex={-1}
                                    onPointerEnter={() => {
                                      setHover({
                                        type: "vertex",
                                        instanceId: instance.id,
                                        polygonId: polygon.id,
                                        points: polygon.points,
                                        vertex: index,
                                      });
                                    }}
                                    onPointerLeave={() => {
                                      setHover(undefined);
                                    }}
                                    onFocus={() => {
                                      setSelectedVertices([
                                        { polygonId: polygon.id, vertex: index },
                                      ]);
                                      viewport.current?.focus({ preventScroll: true });
                                    }}
                                    cx={vertex.x * size.width}
                                    cy={vertex.y * size.height}
                                    r={8 / screenScale}
                                    fill="transparent"
                                    pointerEvents="all"
                                    style={{ cursor: "grab" }}
                                    onPointerDown={(event) => {
                                      startShape(
                                        event,
                                        instance.id,
                                        polygon.id,
                                        polygon.points,
                                        index,
                                      );
                                    }}
                                  />
                                  <circle
                                    data-testid="vertex-handle-visible"
                                    data-highlighted={highlighted}
                                    data-selected={selected}
                                    aria-hidden="true"
                                    pointerEvents="none"
                                    cx={vertex.x * size.width}
                                    cy={vertex.y * size.height}
                                    r={4.5 / screenScale}
                                    fill={highlighted || selected ? color : "white"}
                                    stroke={highlighted || selected ? "white" : color}
                                    strokeWidth={1.5 / screenScale}
                                  />
                                </g>
                              );
                            })}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            {hover?.type === "edge" &&
              !locked &&
              state.editing &&
              state.viewMode !== "original" &&
              inFocus(hover.instanceId, hover.polygonId) &&
              !drawingId &&
              !panTool &&
              !spaceHeld &&
              !peekOriginal && (
                <g
                  data-testid="edge-insert-indicator"
                  aria-hidden="true"
                  pointerEvents="none"
                  transform={`translate(${hover.point.x * size.width} ${hover.point.y * size.height})`}
                >
                  <circle
                    r={7 / screenScale}
                    fill="white"
                    stroke="#4c8dff"
                    strokeWidth={2 / screenScale}
                  />
                  <path
                    d={`M${-3.5 / screenScale},0 H${3.5 / screenScale} M0,${-3.5 / screenScale} V${3.5 / screenScale}`}
                    stroke="#2b6bd4"
                    strokeWidth={1.8 / screenScale}
                  />
                </g>
              )}
            {marquee && (
              <rect
                data-testid="selection-rectangle"
                aria-hidden="true"
                pointerEvents="none"
                x={Math.min(marquee.a.x, marquee.b.x) * size.width}
                y={Math.min(marquee.a.y, marquee.b.y) * size.height}
                width={Math.abs(marquee.a.x - marquee.b.x) * size.width}
                height={Math.abs(marquee.a.y - marquee.b.y) * size.height}
                fill="rgba(76, 141, 255, 0.15)"
                stroke="#4c8dff"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {drawingId && state.viewMode !== "original" && !peekOriginal && (
              <g pointerEvents="none">
                <polyline
                  points={draft.map((p) => `${p.x * size.width},${p.y * size.height}`).join(" ")}
                  fill="none"
                  stroke="white"
                  strokeWidth={4 / 3 / screenScale}
                />
                {draft.map((p, index) => (
                  <circle
                    key={index}
                    cx={p.x * size.width}
                    cy={p.y * size.height}
                    r={5.25 / screenScale}
                    fill="#00bfa5"
                  />
                ))}
              </g>
            )}
          </g>
        </svg>
      </Box>
      <Menu
        data-segmentation-input="canvas"
        open={contextMenu != undefined}
        onClose={() => {
          setContextMenu(undefined);
        }}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
      >
        {contextMenu?.target && (
          <MenuItem
            onClick={() => {
              const target = contextMenu.target!;
              if (!drawingId) {
                state.setFocus({ type: "polygon", id: target.polygonId });
              }
              state.setSelection([{ type: "polygon", id: target.polygonId }]);
              setContextMenu(undefined);
            }}
          >
            {text("Focus polygon", "聚焦多边形")}
          </MenuItem>
        )}
        {contextMenu?.target?.type === "vertex" && (
          <MenuItem
            disabled={
              locked ||
              !state.editing ||
              drawingId != undefined ||
              contextMenu.target.points.length <= 3
            }
            onClick={() => {
              const target = contextMenu.target;
              if (target?.type === "vertex" && !locked && state.editing && !drawingId) {
                removeVertexAt(target.polygonId, target.points, target.vertex);
              }
              setContextMenu(undefined);
            }}
          >
            {text("Delete vertex", "删除顶点")}
          </MenuItem>
        )}
        {drawingId && (
          <MenuItem
            disabled={locked || draft.length < 3}
            onClick={() => {
              finishDrawing();
              setContextMenu(undefined);
            }}
          >
            {text("Finish polygon", "完成多边形")}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            fit();
            setContextMenu(undefined);
          }}
        >
          {text("Fit image", "适应图像")}
        </MenuItem>
        <MenuItem
          disabled={!state.focus}
          onClick={() => {
            fitSelection();
            setContextMenu(undefined);
          }}
        >
          {text("Fit selection", "适应选区")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setShortcutsOpen(true);
            setContextMenu(undefined);
          }}
        >
          {text("Keyboard shortcuts", "键盘快捷键")}
        </MenuItem>
      </Menu>
      <Dialog
        data-segmentation-input="canvas"
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{text("Annotation controls", "标注操作")}</DialogTitle>
        <DialogContent>
          <Typography component="p">
            {text(
              "Focus the annotation viewport to use these shortcuts. Timeline and playback controls keep their own keyboard behavior.",
              "聚焦标注画布后使用以下快捷键；时间轴和播放控件保留自身的键盘行为。",
            )}
          </Typography>
          <Box component="dl" className={classes.shortcutList}>
            <dt>{text("Navigate", "浏览")}</dt>
            <dd>
              {text(
                "Wheel: zoom at pointer (Mouse profile). Trackpad profile: two-finger scroll pans; pinch/Ctrl-wheel zooms. Space + left drag, middle drag, or right drag: pan. H: toggle pan tool. + / −: zoom. F: fit image. 0: actual 100%. Shift+F: fit selection.",
                "鼠标模式：滚轮以指针为中心缩放。触控板模式：双指滑动平移，捏合/Ctrl+滚动缩放。空格+左键、中键或右键拖动：平移。H：切换平移工具。+ / −：缩放。F：适应图像。0：实际 100%。Shift+F：适应选区。",
              )}
            </dd>
            <dt>{text("Edit geometry", "编辑几何")}</dt>
            <dd>
              {text(
                "Drag a vertex or polygon fill. Drag empty canvas: box-select points. Click an edge: insert a point. Delete/Backspace or Alt-click a selected point: delete (keep at least 3). Click to draw; Enter finishes; Esc cancels. Right-click without dragging opens annotation actions.",
                "拖动顶点或多边形填充。拖动空白处：框选顶点。单击边：加点。Delete/Backspace 或 Alt+点击选中顶点：删点（至少保留 3 点）。点击绘制，Enter 完成，Esc 取消。右键单击打开标注菜单。",
              )}
            </dd>
            <dt>{text("Keyboard points", "键盘顶点编辑")}</dt>
            <dd>
              {text(
                "Tab enters/leaves the viewport once. Enter on a selected polygon starts editing; Enter again finishes. Click a point (Shift+click or drag a box on empty canvas to select several), then arrows move the selected points by 1 image pixel, Shift+arrows by 10. Dragging one selected point moves them all; Delete removes them. Esc clears the point selection. Space+arrows pans.",
                "Tab 一次进入或离开画布。选中多边形后按 Enter 开始编辑，再按 Enter 完成。点击顶点（Shift+点击或在空白处拖出选框可多选）后，方向键移动选中顶点 1 图像像素，Shift+方向键移动 10 像素。拖动其中一个选中顶点会整体移动；Delete 删除。Esc 取消选择。空格+方向键平移。",
              )}
            </dd>
            <dt>{text("History and appearance", "历史与显示")}</dt>
            <dd>
              {text(
                "Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z or Ctrl+Y: redo. Hold O: peek at original pixels. Use Opacity to adjust fills. Navigation never adds annotation history; read-only revisions remain navigable.",
                "Ctrl/Cmd+Z：撤销。Ctrl/Cmd+Shift+Z 或 Ctrl+Y：重做。按住 O：查看原图。透明度滑块调整填充。浏览不产生标注历史；只读版本仍可缩放和平移。",
              )}
            </dd>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setShortcutsOpen(false);
            }}
          >
            {text("Close", "关闭")}
          </Button>
        </DialogActions>
      </Dialog>
      {!compact && (
        <Typography variant="caption" className={classes.footer} aria-live="polite">
          {selectedEditable.length > 1
            ? text(
                `${selectedEditable.length} points selected: arrows move them 1 image pixel (Shift = 10); drag one to move all; Delete removes them; Esc clears.`,
                `已选 ${selectedEditable.length} 个顶点：方向键移动 1 图像像素（Shift 为 10）；拖动其中一个整体移动；Delete 删除；Esc 取消选择。`,
              )
            : activePoint
              ? text(
                  `Point ${activePoint.vertex + 1} (${Math.round(activePoint.point.x * size.width)}, ${Math.round(activePoint.point.y * size.height)}): arrows move 1 image pixel; Shift = 10; Shift+click adds points.`,
                  `顶点 ${activePoint.vertex + 1}（${Math.round(activePoint.point.x * size.width)}, ${Math.round(activePoint.point.y * size.height)}）：方向键移动 1 图像像素；Shift 为 10；Shift+点击可多选。`,
                )
              : drawingId
                ? `Drawing: ${draft.length} vertices · Space/middle/right drag to pan`
                : state.editing
                  ? text(
                      "Drag points/fill; drag empty canvas to box-select points; Shift+click multi-selects; click edge to add; Delete removes selected points. Arrows move selected points; Enter finishes editing. Space/right drag pans; wheel zooms; ? help.",
                      "拖动顶点/填充；拖动空白处框选顶点；Shift+点击多选；单击边加点；Delete 删除选中顶点。方向键移动选中顶点，Enter 完成编辑。空格/右键拖动平移；滚轮缩放；? 查看帮助。",
                    )
                  : text(
                      "Select an instance, then enable Edit to adjust polygons.",
                      "先选择实例，再点击“编辑”调整多边形。",
                    )}
        </Typography>
      )}
    </Stack>
  );
}

export default SegmentationCanvas;
