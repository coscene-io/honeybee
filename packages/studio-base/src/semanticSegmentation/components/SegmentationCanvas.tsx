// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import PanToolIcon from "@mui/icons-material/PanTool";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { ShortcutKeys } from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcuts";
import { openKeyboardShortcuts } from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";

import {
  annotationPopupProps,
  annotationViewportProps,
  isAnnotationCanvasTarget,
} from "../annotationInput";
import { segmentationViewControls } from "../imageSource";
import { bitmapOfRuns, maskContains } from "../maskCodec";
import {
  applyStroke,
  maskConversionLoss,
  maskOf,
  polygonsOf,
  runsOfMask,
  strokeRuns,
} from "../maskGeometry";
import {
  clampUnit,
  hasPolygonArea,
  nearestPolygonEdge,
  polygonPath,
  screenToNormalized,
  translatePolygon,
} from "./editorGeometry";
import type { EditorPoint } from "./editorGeometry";
import { beginPolygonEdit, findPolygonOwner, focusContains } from "./polygonEdit";
import { segmentationErrorText } from "../errors";
import { maskOverlayControls } from "../maskOverlay/overlaySource";
import type { QuickPoint } from "../quickSegment";
import { segmentationSession, type DecodedSegmentationFrame } from "../runtime";
import { frameInstanceKey } from "../service";
import { SEGMENTATION_SHORTCUTS } from "../shortcuts";
import type {
  CreationTool,
  MaskConversionLoss,
  SegmentationMask,
  SemanticSegmentationStore,
} from "../types";

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
  toolsPanel: {
    position: "absolute",
    right: theme.spacing(1.5),
    bottom: theme.spacing(7),
    zIndex: 6,
    width: 240,
    maxWidth: `calc(100% - ${theme.spacing(3)})`,
    padding: 6,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    boxShadow: theme.shadows[8],
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingInline: 8,
    fontSize: theme.typography.body2.fontSize,
    "@media (pointer: coarse)": { height: 48 },
  },
  menuButton: {
    "&&": {
      justifyContent: "flex-start",
      width: "100%",
      minWidth: 0,
      borderRadius: 4,
      color: theme.palette.text.primary,
      textTransform: "none",
      fontSize: theme.typography.body2.fontSize,
      fontWeight: "inherit",
      whiteSpace: "nowrap",
      "& svg": { color: theme.palette.text.secondary },
      "&[aria-pressed=true]": { backgroundColor: theme.palette.action.selected },
      "&.Mui-disabled": { color: theme.palette.text.disabled },
    },
  },
  menuKeys: { marginLeft: "auto" },
  stepper: { justifyContent: "space-between" },
  stepperButton: {
    "&&": {
      borderRadius: 4,
      color: theme.palette.text.primary,
      "& svg": { color: theme.palette.text.secondary },
    },
  },
  menuSlider: {
    marginLeft: "auto",
    width: 100,
    minWidth: 0,
    accentColor: theme.palette.primary.main,
  },
  menuDivider: { marginBlock: 6 },
  menuCaption: {
    color: theme.palette.text.secondary,
    fontVariantNumeric: "tabular-nums",
    paddingInline: 8,
    paddingBlock: 2,
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
  chip: {
    alignSelf: "flex-start",
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.borderRadius,
    background: "rgba(0, 0, 0, 0.55)",
    color: "#fff",
    lineHeight: 1.6,
  },
  hint: {
    paddingBlock: 0,
    fontSize: theme.typography.caption.fontSize,
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    "& .MuiAlert-message": { paddingBlock: theme.spacing(0.5) },
    "& .MuiAlert-action": { paddingTop: 0, color: "#fff" },
  },
  toolRow: {
    alignSelf: "flex-start",
    alignItems: "center",
    padding: theme.spacing(0.25),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: theme.shadows[2],
    "& .MuiButton-root": { textTransform: "none", minWidth: 0 },
  },
  toolKey: {
    marginLeft: 4,
    opacity: 0.7,
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
  },
  toolLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingInline: 4,
    fontSize: theme.typography.caption.fontSize,
    "& input": { width: 80, accentColor: theme.palette.primary.main },
  },
}));

export type SegmentationCanvasProps = {
  /** False on canvases that do not hold the edit: they show no errors or drawing help. */
  active?: boolean;
  store: StoreApi<SemanticSegmentationStore>;
  viewportRef?: RefObject<ReactNull | HTMLDivElement>;
  imageUrl?: string;
  disabled?: boolean;
  decodedFrame?: DecodedSegmentationFrame;
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
      /** Last pointer position, for incremental pans of the Image panel's camera. */
      last?: EditorPoint;
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
      // A brush or eraser stroke on the focused instance's mask (normalized points).
      type: "stroke";
      points: EditorPoint[];
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
  { type: "vertex"; vertex: number } | { type: "edge"; after: number; point: EditorPoint }
);

export function SegmentationCanvas({
  store,
  viewportRef,
  imageUrl,
  disabled = false,
  decodedFrame,
  frameId: shownFrameId,
  onClaimFocus,
  active = true,
}: SegmentationCanvasProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  // Only the fields read here (actions are stable): a whole-store subscription re-rendered this
  // component for every queue, error and propagation-progress update.
  const state = useStore(
    store,
    useShallow((s) => ({
      addMask: s.addMask,
      addPolygon: s.addPolygon,
      cancelDrawing: s.cancelDrawing,
      convertToMask: s.convertToMask,
      convertToPolygons: s.convertToPolygons,
      creationTool: s.creationTool,
      currentFrameId: s.currentFrameId,
      document: s.document,
      drawing: s.drawing,
      editing: s.editing,
      focus: s.focus,
      interactionResetVersion: s.interactionResetVersion,
      propagationStatus: s.propagation.status,
      replaceMask: s.replaceMask,
      runTransaction: s.runTransaction,
      selection: s.selection,
      setCreationTool: s.setCreationTool,
      setEditing: s.setEditing,
      setFocus: s.setFocus,
      setPolygonPoints: s.setPolygonPoints,
      setSelection: s.setSelection,
      stagedOperations: s.stagedOperations,
      viewMode: s.viewMode,
    })),
  );
  const { t } = useTranslation("segmentation");
  const root = useRef<HTMLDivElement>(ReactNull);
  const content = useRef<SVGGElement>(ReactNull);
  const localViewport = useRef<HTMLDivElement>(ReactNull);
  const viewport = viewportRef ?? localViewport;
  const drag = useRef<Drag | undefined>(undefined);
  const capture = useRef<{ element: SVGElement; pointerId: number } | undefined>(undefined);
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    keyboard?: boolean;
    target?: HoverTarget | PolygonTarget;
  }>();
  const [opacity, setOpacity] = useState(0.5);
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  view.current = { zoom, pan };
  const previewRef = useRef<Preview | undefined>(undefined);
  const [draft, setDraft] = useState<EditorPoint[]>([]);
  const [quickPoints, setQuickPoints] = useState<QuickPoint[]>([]);
  const [quickResult, setQuickResult] = useState<
    | {
        mask: SegmentationMask;
        score: number;
        url: string;
        x0: number;
        y0: number;
        w: number;
        h: number;
      }
    | undefined
  >();
  const [quickBusy, setQuickBusy] = useState(false);
  const quickRequest = useRef<AbortController | undefined>(undefined);
  const [preview, setPreview] = useState<Preview>();
  // Dismissing the drawing help is remembered; it is a one-line hint, not a per-drawing banner.
  const [showHelp, setShowHelpState] = useState(() => {
    try {
      return (
        globalThis.localStorage.getItem("coStudio.semanticSegmentation.drawingHelp") !== "hidden"
      );
    } catch {
      return true;
    }
  });
  const setShowHelp = (value: "shown" | "hidden") => {
    setShowHelpState(value === "shown");
    try {
      globalThis.localStorage.setItem("coStudio.semanticSegmentation.drawingHelp", value);
    } catch {
      // Storage may be disabled; the choice still applies to this canvas.
    }
  };
  const [error, setError] = useState<string>();
  /** A representation change the last command made (e.g. polygons rasterized into a mask). */
  const [notice, setNotice] = useState<string>();
  /** Brush/eraser for mask observations; the radius is in source pixels. */
  const [brush, setBrush] = useState<{ mode: "paint" | "erase"; radius: number }>({
    mode: "paint",
    radius: 12,
  });
  const [brushCursor, setBrushCursor] = useState<EditorPoint>();
  const [stroke, setStroke] = useState<EditorPoint[]>();
  const [conversion, setConversion] = useState<
    { instanceId: string; loss: MaskConversionLoss } | undefined
  >();
  const activeFrameId = state.currentFrameId;
  const frameId = shownFrameId ?? activeFrameId;
  const frame = state.document?.frames.find((item) => item.id === frameId);
  const source = imageUrl ?? frame?.imageUrl;
  const nativeView = decodedFrame?.nativeView;
  useLayoutEffect(() => {
    if (nativeView) {
      setSize({ width: nativeView.imageWidth, height: nativeView.imageHeight });
    }
  }, [nativeView]);
  useEffect(() => {
    // The GPU mask layer mirrors this canvas's overlay opacity and "peek original" hold.
    maskOverlayControls.setState({ opacity, peekOriginal });
  }, [opacity, peekOriginal]);
  const strokeFrameId = useStore(segmentationSession, (session) => session.strokeFrameId);
  const draftElsewhere =
    shownFrameId != undefined && strokeFrameId != undefined && shownFrameId !== strokeFrameId;
  const navigationLocked = disabled || ["running", "stopping"].includes(state.propagationStatus);
  const locked =
    disabled ||
    draftElsewhere ||
    ["running", "stopping"].includes(state.propagationStatus) ||
    !source ||
    !nativeView;
  const drawing = state.drawing;
  const tool = state.creationTool;
  // Quick annotation (SAM2 clicks) and vertex drawing are the two ways to create geometry.
  const quickMode = drawing != undefined && tool === "quick";
  const document = state.document;
  /** The instance an edit applies to: the focused instance, or the owner of a focused polygon. */
  const focusedInstanceId =
    state.focus?.type === "instance"
      ? state.focus.id
      : state.focus?.type === "polygon"
        ? findPolygonOwner(document, frameId, state.focus.id)?.instanceId
        : undefined;
  const focusedObservation =
    focusedInstanceId != undefined && frameId != undefined
      ? document?.annotations[frameInstanceKey(frameId, focusedInstanceId)]
      : undefined;
  /**
   * Editing a mask, or an instance with nothing on this frame yet, paints with the brush: a mask
   * stays pixels (lossless). Polygon observations keep vertex editing.
   */
  const brushActive =
    !locked &&
    state.editing &&
    drawing == undefined &&
    focusedInstanceId != undefined &&
    state.viewMode !== "original" &&
    focusedObservation?.kind !== "polygons";
  const unreadableHere = Object.values(document?.unreadableObservations ?? {}).filter(
    (item) => item.frameId === frameId,
  );
  useEffect(() => {
    quickRequest.current?.abort();
    setQuickPoints([]);
    setQuickResult(undefined);
    setQuickBusy(false);
    return () => {
      quickRequest.current?.abort();
    };
  }, [drawing, frameId, tool]);
  useEffect(() => {
    setStroke(undefined);
    setBrushCursor(undefined);
  }, [brushActive, frameId, focusedInstanceId]);
  /** The decoded source size of the shown frame's camera, which masks are bound to. */
  function sourceSize(): { width: number; height: number } {
    const video = document?.videos.find((item) => item.id === frame?.videoId);
    return { width: video?.width ?? size.width, height: video?.height ?? size.height };
  }
  function finishStroke(points: EditorPoint[]): void {
    if (!focusedInstanceId || points.length === 0) {
      return;
    }
    const { width, height } = sourceSize();
    const pixels = points.map((p) => ({ x: p.x * width, y: p.y * height }));
    run(() => {
      const runs = strokeRuns(pixels, brush.radius, width, height);
      if (runs.area === 0) {
        return;
      }
      if (focusedObservation?.kind === "polygons") {
        throw new Error(t("convertBeforePainting"));
      }
      const mask = applyStroke(focusedObservation, runs, brush.mode);
      state.replaceMask(focusedInstanceId, mask, brush.mode === "paint" ? "Brush" : "Erase");
    });
  }
  function openPolygonConversion(instanceId: string): void {
    const observation =
      frameId != undefined
        ? document?.annotations[frameInstanceKey(frameId, instanceId)]
        : undefined;
    if (observation?.kind !== "mask") {
      return;
    }
    run(() => {
      const loss = maskConversionLoss(observation.mask);
      // Lossless conversions need no confirmation.
      if (loss.lostPixels === 0 && loss.addedPixels === 0 && loss.holes === 0) {
        state.convertToPolygons(instanceId);
        setNotice(t("convertedMaskPolygons"));
      } else {
        setConversion({ instanceId, loss });
      }
    });
  }
  function requestQuickMask(points: QuickPoint[]): void {
    setQuickPoints(points);
    quickRequest.current?.abort();
    if (points.length === 0 || !points.some((item) => item.positive)) {
      setQuickResult(undefined);
      setQuickBusy(false);
      return;
    }
    const video = document?.videos.find((item) => item.id === frame?.videoId);
    const width = video?.width ?? size.width;
    const height = video?.height ?? size.height;
    if (!frame || video?.topic == undefined || !(width > 0) || !(height > 0) || !source) {
      setError(t("frameNotReady"));
      return;
    }
    const controller = new AbortController();
    quickRequest.current = controller;
    setQuickBusy(true);
    void store
      .getState()
      .segmentFrame(
        { topic: video.topic, logTimeNs: frame.logTimeNs, width, height, imageUrl: source, points },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        if (result.mask == undefined) {
          // The contract: no foreground selected, keep the previous result.
          setNotice(t("quickSelectsNothing"));
          setError(undefined);
          return;
        }
        const mask = result.mask;
        const bitmap = bitmapOfRuns(runsOfMask(mask));
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(bitmap.w, 1);
        canvas.height = Math.max(bitmap.h, 1);
        const context = canvas.getContext("2d");
        if (context && bitmap.w > 0) {
          const pixels = context.createImageData(bitmap.w, bitmap.h);
          for (let i = 0; i < bitmap.bits.length; i++) {
            if (bitmap.bits[i] === 1) {
              pixels.data.set([76, 141, 255, 130], i * 4);
            }
          }
          context.putImageData(pixels, 0, 0);
        }
        setQuickResult({ mask, score: result.score, url: canvas.toDataURL(), ...bitmap });
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(segmentationErrorText(err));
        }
      })
      .finally(() => {
        if (quickRequest.current === controller) {
          setQuickBusy(false);
        }
      });
  }
  function addQuickPoint(
    event: { clientX: number; clientY: number },
    kind: "positive" | "negative",
  ): void {
    const next = point(event);
    if (!next) {
      return;
    }
    if (segmentationSession.getState().strokeFrameId == undefined) {
      segmentationSession.setState({ strokeFrameId: shownFrameId ?? frameId });
    }
    requestQuickMask([
      ...quickPoints,
      { x: clampUnit(next.x), y: clampUnit(next.y), positive: kind === "positive" },
    ]);
  }

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
  }, [zoom, nativeView, size.width, size.height, viewport]);

  const cancelGesture = useCallback((): void => {
    drag.current = undefined;
    previewRef.current = undefined;
    setPreview(undefined);
    setStroke(undefined);
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
      setError(segmentationErrorText(err));
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
    // Geometry edits may clone focus; only a meaningful scope change resets keyboard mode.
  }, [
    resetTemporaryInput,
    state.focus?.type,
    state.focus?.id,
    state.editing,
    state.viewMode,
    locked,
    navigationLocked,
    drawing,
    panTool,
  ]);

  useEffect(() => {
    setDraft([]);
    resetTemporaryInput();
    setSelectedVertices([]);
    setContextMenu(undefined);
    setHover(undefined);
    setError(undefined);
  }, [drawing, frameId, state.interactionResetVersion, store, resetTemporaryInput]);
  useEffect(() => {
    if (
      store.getState().drawing == undefined &&
      segmentationSession.getState().strokeFrameId != undefined
    ) {
      segmentationSession.setState({ strokeFrameId: undefined });
    }
  }, [drawing, store]);
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
  /** Over the Image panel the view is the panel's camera; drive it instead of our own zoom. */
  function panelView(): ReturnType<typeof segmentationViewControls.get> {
    const canvas = decodedFrame?.nativeCanvas;
    return canvas ? segmentationViewControls.get(canvas) : undefined;
  }
  /**
   * Presses that belong to the Image panel alone: middle button, Space or the pan tool, and a
   * left press on empty canvas when not editing. While editing, a left drag on empty canvas
   * box-selects vertices (handled by the canvas); right-drag pans.
   */
  function nativePanOnly(event: { button: number; clientX: number; clientY: number }): boolean {
    return (
      event.button === 1 ||
      space.current ||
      panTool ||
      (event.button === 0 && !drawing && !state.editing && !hitTarget(event))
    );
  }
  function viewportCenter(): EditorPoint | undefined {
    const bounds = viewport.current?.getBoundingClientRect();
    return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : undefined;
  }
  function zoomAt(next: number, client?: EditorPoint): void {
    const native = panelView();
    const at = client ?? viewportCenter();
    if (!navigationLocked && native && at && zoom > 0) {
      native.zoom(next / zoom, at.x, at.y);
    }
  }
  function fit(): void {
    if (navigationLocked) {
      return;
    }
    panelView()?.reset();
  }
  function fitSelection(): void {
    if (navigationLocked) {
      return;
    }
    cancelGesture();
    const points = Object.values(document?.annotations ?? {})
      .filter((a) => a.frameId === frameId)
      .flatMap((a) => {
        if (a.kind === "mask") {
          // A mask observation in focus contributes its bounding box.
          const box = focusContains(document, state.focus, frameId, a.instanceId, "")
            ? runsOfMask(a.mask).bbox
            : undefined;
          return box
            ? [
                { x: box.x0 / a.mask.width, y: box.y0 / a.mask.height },
                { x: (box.x1 + 1) / a.mask.width, y: (box.y1 + 1) / a.mask.height },
              ]
            : [];
        }
        return a.polygons.filter((p) => inFocus(a.instanceId, p.id)).flatMap((p) => p.points);
      });
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds || points.length === 0) {
      return;
    }
    // Selection bounds on screen through the native transform, then zoom and center them.
    {
      const native = panelView();
      const matrix = content.current?.getScreenCTM();
      if (!native || !matrix) {
        return;
      }
      const onScreen = points.map((p) => ({
        x: matrix.a * p.x * size.width + matrix.c * p.y * size.height + matrix.e,
        y: matrix.b * p.x * size.width + matrix.d * p.y * size.height + matrix.f,
      }));
      const left = Math.min(...onScreen.map((p) => p.x));
      const right = Math.max(...onScreen.map((p) => p.x));
      const top = Math.min(...onScreen.map((p) => p.y));
      const bottom = Math.max(...onScreen.map((p) => p.y));
      const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const ratio =
        0.85 *
        Math.min(
          bounds.width / Math.max(1, right - left),
          bounds.height / Math.max(1, bottom - top),
        );
      native.zoom(ratio, center.x, center.y);
      native.panBy(bounds.x + bounds.width / 2 - center.x, bounds.y + bounds.height / 2 - center.y);
    }
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
      decodedFrame?.nativeCanvas?.dispatchEvent(new WheelEvent("wheel", event));
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
      setError(segmentationErrorText(err));
    }
  }
  function inFocus(instanceId: string, polygonId: string): boolean {
    return focusContains(document, state.focus, frameId, instanceId, polygonId);
  }
  /** Polygons on this frame inside the edit scope (the focused instance or class). */
  const scopePolygons =
    frameId == undefined
      ? []
      : Object.values(document?.annotations ?? {})
          .filter((annotation) => annotation.frameId === frameId)
          .flatMap((annotation) =>
            polygonsOf(annotation)
              .filter((polygon) => inFocus(annotation.instanceId, polygon.id))
              .map((polygon) => polygon.id),
          );
  /**
   * The one polygon whose vertices are edited: the focused polygon, else the single selected one,
   * else the only polygon in scope. Other polygons in scope are only highlighted; pressing one
   * makes it the active polygon.
   */
  const activePolygonId = ((): string | undefined => {
    if (state.focus?.type === "polygon" && scopePolygons.includes(state.focus.id)) {
      return state.focus.id;
    }
    const selected = state.selection.filter(
      (node) => node.type === "polygon" && scopePolygons.includes(node.id),
    );
    if (selected.length === 1) {
      return selected[0]!.id;
    }
    return scopePolygons.length === 1 ? scopePolygons[0] : undefined;
  })();
  /** Vertex handles, edge insertion and dragging belong to the active polygon only. */
  function editsVertices(instanceId: string, polygonId: string): boolean {
    return polygonId === activePolygonId && inFocus(instanceId, polygonId);
  }
  function claimShownFrame(): boolean {
    if (draftElsewhere || shownFrameId == undefined || shownFrameId === activeFrameId) {
      return !draftElsewhere;
    }
    const live = store.getState();
    try {
      if (live.drawing != undefined) {
        if (segmentationSession.getState().strokeFrameId != undefined) {
          return false;
        }
        live.retargetDrawing(shownFrameId);
      } else {
        live.setCurrentFrame(shownFrameId);
      }
    } catch (err) {
      setError(segmentationErrorText(err));
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
      drawing ||
      panTool ||
      space.current ||
      peekOriginal ||
      event.button !== 0
    ) {
      return;
    }
    if (!claimShownFrame()) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    setHover(undefined);
    viewport.current?.focus({ preventScroll: true });
    // Pressing another polygon in scope first makes it the active one; only that one drags.
    const canEdit = !locked && state.editing && editsVertices(instanceId, polygonId);
    const pressed: VertexRef | undefined = vertex == undefined ? undefined : { polygonId, vertex };
    state.setSelection([{ type: "polygon", id: polygonId }]);
    if (!canEdit) {
      if (pressed) {
        setSelectedVertices([pressed]);
      }
      // Inside the edit scope the press only activates this polygon (the selection above); the
      // scope, e.g. a focused class, stays. Outside it, focus moves to the pressed instance.
      if (!(state.editing && inFocus(instanceId, polygonId))) {
        state.setFocus({ type: "instance", id: instanceId });
      }
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
      drawing ||
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
        polygonsOf(annotation)
          .filter((polygon) => editsVertices(annotation.instanceId, polygon.id))
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
    if (drawing) {
      return undefined;
    }
    const nearby = hitTarget(event);
    if (nearby) {
      return nearby;
    }
    if (peekOriginal || state.viewMode === "original") {
      return undefined;
    }
    const location = point(event);
    if (!location) {
      return undefined;
    }
    const polygons = Object.values(document?.annotations ?? {})
      .filter((a) => a.frameId === frameId)
      .flatMap((a) =>
        polygonsOf(a)
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
        setError(t("polygonMinVertices"));
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
      !editsVertices(instanceId, polygonId) ||
      drawing ||
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
  function switchTool(next: CreationTool): void {
    if (next === tool) {
      return;
    }
    setDraft([]);
    segmentationSession.setState({ strokeFrameId: undefined });
    run(() => {
      state.setCreationTool(next);
    });
  }
  function finishDrawing(): void {
    if (!drawing || locked || !frameId) {
      return;
    }
    const before = document?.annotations[frameInstanceKey(frameId, drawing.instanceId)]?.kind;
    if (quickMode) {
      if (quickBusy) {
        setError(t("maskStillComputing"));
        return;
      }
      if (!quickResult) {
        setError(t("quickClickFirst"));
        return;
      }
      const mask = { ...quickResult.mask, source: "quick" as const };
      run(() => {
        state.addMask(drawing.instanceId, mask);
        if (before === "polygons") {
          setNotice(t("polygonsMergedIntoMask"));
        }
      });
      segmentationSession.setState({ strokeFrameId: undefined });
      return;
    }
    if (draft.length < 3) {
      setError(t("addThreeVertices"));
      return;
    }
    if (!hasPolygonArea(draft)) {
      setError(t("verticesZeroArea"));
      return;
    }
    run(() => {
      state.addPolygon(drawing.instanceId, draft);
      setDraft([]);
      if (before === "mask") {
        setNotice(t("polygonRasterized"));
      }
    });
    segmentationSession.setState({ strokeFrameId: undefined });
  }

  const vertices =
    !locked && state.editing && !drawing && state.viewMode !== "original"
      ? Object.values(document?.annotations ?? {})
          .filter((a) => a.frameId === frameId)
          .flatMap((a) =>
            polygonsOf(a)
              .filter((p) => editsVertices(a.instanceId, p.id))
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
    if (locked || navigationLocked || drawing || panTool || peekOriginal || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    run(() => {
      beginPolygonEdit(store.getState(), polygonId);
    });
  }
  /**
   * Double-clicking a mask (drawn on the GPU, so no SVG element receives it) edits that instance's
   * mask on this frame with the brush. It stays a mask: converting to polygons is explicit.
   */
  function doubleClickMask(event: ReactMouseEvent<SVGSVGElement>): void {
    if (
      locked ||
      navigationLocked ||
      drawing ||
      panTool ||
      peekOriginal ||
      event.button !== 0 ||
      state.viewMode === "original" ||
      !document ||
      frameId == undefined
    ) {
      return;
    }
    const at = point(event);
    if (!at) {
      return;
    }
    // Topmost first, matching the overlay: a selected instance, then the highest slot.
    const candidates = document.instances
      .filter((instance) => {
        const mask = maskOf(document.annotations[frameInstanceKey(frameId, instance.id)]);
        return (
          mask != undefined &&
          (state.viewMode === "all" ||
            state.focus?.id === instance.id ||
            state.focus?.id === instance.classId) &&
          maskContains(runsOfMask(mask), at.x * mask.width, at.y * mask.height)
        );
      })
      .reverse();
    const hit =
      candidates.find((instance) =>
        state.selection.some((ref) => ref.id === instance.id || ref.id === instance.classId),
      ) ?? candidates[0];
    if (!hit || !claimShownFrame()) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    run(() => {
      const live = store.getState();
      live.setFocus({ type: "instance", id: hit.id });
      live.setSelection([{ type: "instance", id: hit.id }]);
      if (live.viewMode === "original") {
        live.setViewMode("all");
      }
      live.setEditing(true);
    });
  }
  /** Enter on a selected polygon: start editing it. */
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
        beginPolygonEdit(store.getState(), polygonId);
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
      aria-label={t("canvasLabel")}
      {...annotationViewportProps}
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
        if (drawing && !locked && ["p", "P", "q", "Q"].includes(event.key)) {
          // P / Q switch the creation tool; the draft of the other tool is discarded.
          event.preventDefault();
          event.stopPropagation();
          switchTool(event.key.toLowerCase() === "q" ? "quick" : "polygon");
          return;
        }
        if (brushActive && ["b", "B", "e", "E", "[", "]"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const key = event.key.toLowerCase();
          setBrush((current) =>
            key === "b"
              ? { ...current, mode: "paint" }
              : key === "e"
                ? { ...current, mode: "erase" }
                : {
                    ...current,
                    radius: Math.max(
                      1,
                      Math.min(200, Math.round(current.radius * (key === "]" ? 1.25 : 0.8))),
                    ),
                  },
          );
          return;
        }
        if (["+", "=", "-", "f", "F", "0", "h", "H", "?", "o", "O"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (navigationLocked) {
            return;
          }
          if (event.key === "?") {
            openKeyboardShortcuts();
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
          // Arrows belong to the canvas only to pan (with Space) or to nudge selected points.
          // Otherwise ←/→ step the editing camera's frames: let them reach the playback shortcuts.
          if (!peekOriginal && !space.current && selectedEditable.length === 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (peekOriginal) {
            return;
          }
          const panel = panelView();
          if (space.current && !navigationLocked && panel) {
            const dx = event.key === "ArrowLeft" ? 20 : event.key === "ArrowRight" ? -20 : 0;
            const dy = event.key === "ArrowUp" ? 20 : event.key === "ArrowDown" ? -20 : 0;
            panel.panBy(dx, dy);
          } else if (space.current && !navigationLocked) {
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
          if (drawing) {
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
          if (drawing && quickMode) {
            requestQuickMask(quickPoints.slice(0, -1));
            return;
          }
          if (drawing || !state.editing || panTool || peekOriginal) {
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
          if (selectedVertices.length > 0 && !drawing) {
            setSelectedVertices([]);
            return;
          }
          setDraft([]);
          setPreview(undefined);
          setMarquee(undefined);
          setStroke(undefined);
          previewRef.current = undefined;
          drag.current = undefined;
          setPanning(false);
          state.cancelDrawing();
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
      {toolsOpen && (
        <div
          className={classes.toolsPanel}
          role="group"
          aria-label={t("viewTools")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
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
          <div className={cx(classes.menuRow, classes.stepper)}>
            <IconButton
              size="small"
              className={classes.stepperButton}
              disabled={navigationLocked}
              aria-label={t("zoomOut")}
              data-tool="zoom-out"
              onClick={() => {
                zoomAt(zoom / 1.25);
              }}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            <Typography variant="body2" aria-live="polite" data-tool="zoom-label">
              {zoom === 1 && pan.x === 0 && pan.y === 0 ? t("fitPrefix") : ""}
              {Math.round(screenScale * 100)}%
            </Typography>
            <IconButton
              size="small"
              className={classes.stepperButton}
              disabled={navigationLocked}
              aria-label={t("zoomIn")}
              data-tool="zoom-in"
              onClick={() => {
                zoomAt(zoom * 1.25);
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </div>
          <Button
            className={classes.menuButton}
            startIcon={<FitScreenIcon />}
            disabled={navigationLocked}
            aria-label={t("fitCanvas")}
            data-tool="fit"
            onClick={() => {
              fit();
            }}
          >
            {t("fitCanvas")}
            <span className={classes.menuKeys}>
              <ShortcutKeys keys={SEGMENTATION_SHORTCUTS.fit} />
            </span>
          </Button>
          <Button
            className={classes.menuButton}
            startIcon={<CenterFocusStrongIcon />}
            disabled={navigationLocked || !state.focus}
            aria-label={t("fitSelection")}
            data-tool="fit-selection"
            onClick={fitSelection}
          >
            {t("fitSelection")}
            <span className={classes.menuKeys}>
              <ShortcutKeys keys={SEGMENTATION_SHORTCUTS.fitSelection} />
            </span>
          </Button>
          <Button
            className={classes.menuButton}
            startIcon={<AspectRatioIcon />}
            disabled={navigationLocked}
            data-tool="actual"
            onClick={() => {
              zoomAt(zoom / screenScale);
            }}
          >
            {t("actualSize")}
            <span className={classes.menuKeys}>
              <ShortcutKeys keys={SEGMENTATION_SHORTCUTS.actualSize} />
            </span>
          </Button>
          <Button
            className={classes.menuButton}
            startIcon={<PanToolIcon />}
            disabled={navigationLocked}
            aria-label={t("pan")}
            aria-pressed={panTool}
            data-tool="pan"
            onClick={() => {
              setPanTool((value) => !value);
            }}
          >
            {t("pan")}
            <span className={classes.menuKeys}>
              <ShortcutKeys keys={SEGMENTATION_SHORTCUTS.panTool} />
            </span>
          </Button>
          <Divider className={classes.menuDivider} />
          <label className={classes.menuRow} data-tool="opacity">
            {t("opacity")}
            <input
              className={classes.menuSlider}
              aria-label={t("overlayOpacity")}
              disabled={navigationLocked}
              type="range"
              min={0}
              max={0.7}
              step={0.05}
              value={opacity}
              onChange={(event) => {
                setOpacity(Number(event.target.value));
              }}
            />
          </label>
          <Divider className={classes.menuDivider} />
          <Button
            className={classes.menuButton}
            startIcon={<KeyboardIcon />}
            data-keep-control-focus
            data-tool="shortcuts"
            aria-label={t("keyboardShortcuts")}
            onClick={() => {
              openKeyboardShortcuts();
            }}
          >
            {t("keyboardShortcuts")}
          </Button>
          <Typography variant="caption" className={classes.menuCaption} data-tool="size">
            {size.width} × {size.height}
          </Typography>
        </div>
      )}
      <IconButton
        className={classes.toolsFab}
        size="small"
        aria-label={t("viewTools")}
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
      <Box
        ref={viewport}
        className={classes.viewport}
        style={{ background: "transparent" }}
        data-testid="segmentation-viewport"
        tabIndex={0}
        role="group"
        aria-label={t("annotationViewport")}
        onPointerDownCapture={(event) => {
          if (nativePanOnly(event)) {
            event.stopPropagation();
          }
        }}
        onMouseDownCapture={(event) => {
          if (nativePanOnly(event)) {
            decodedFrame?.nativeCanvas?.dispatchEvent(
              new MouseEvent("mousedown", event.nativeEvent),
            );
            event.stopPropagation();
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            resetTemporaryInput();
          }
        }}
      >
        <Stack className={classes.notices} spacing={1} data-testid="canvas-notices">
          {!nativeView && <Alert severity="info">{t("viewTransformNotReady")}</Alert>}
          {draftElsewhere && (
            <Typography
              variant="caption"
              role="status"
              className={classes.chip}
              title={t("finishOtherCanvas")}
            >
              {t("drawingAnotherCamera")}
            </Typography>
          )}
          {error && active && (
            <Alert
              severity="error"
              onClose={() => {
                setError(undefined);
              }}
            >
              {error}
            </Alert>
          )}
          {notice && active && (
            <Alert
              severity="info"
              data-testid="geometry-notice"
              onClose={() => {
                setNotice(undefined);
              }}
            >
              {notice}
            </Alert>
          )}
          {unreadableHere.length > 0 && active && (
            <Alert severity="warning" data-testid="unreadable-observations">
              {t("unreadableAnnotations", {
                unreadableHereCount: unreadableHere.length,
                reason: unreadableHere[0]!.reason,
              })}
            </Alert>
          )}
          {drawing && active && !draftElsewhere && !locked && (
            <Stack
              direction="row"
              spacing={0.5}
              role="radiogroup"
              aria-label={t("creationTool")}
              data-testid="creation-tools"
              className={classes.toolRow}
            >
              {(
                [
                  ["polygon", t("polygon"), "P"],
                  ["quick", t("quickSam"), "Q"],
                ] as const
              ).map(([value, label, key]) => (
                <Button
                  key={value}
                  size="small"
                  role="radio"
                  aria-checked={tool === value}
                  variant={tool === value ? "contained" : "text"}
                  data-creation-tool={value}
                  onClick={() => {
                    switchTool(value);
                    viewport.current?.focus({ preventScroll: true });
                  }}
                >
                  {label} <span className={classes.toolKey}>{key}</span>
                </Button>
              ))}
            </Stack>
          )}
          {state.editing &&
            !drawing &&
            active &&
            !locked &&
            focusedInstanceId != undefined &&
            state.viewMode !== "original" && (
              <Stack
                direction="row"
                spacing={0.5}
                data-testid="edit-tools"
                className={classes.toolRow}
              >
                {brushActive && (
                  <>
                    {(
                      [
                        ["paint", t("brush"), "B"],
                        ["erase", t("eraser"), "E"],
                      ] as const
                    ).map(([mode, label, key]) => (
                      <Button
                        key={mode}
                        size="small"
                        aria-pressed={brush.mode === mode}
                        variant={brush.mode === mode ? "contained" : "text"}
                        data-brush-mode={mode}
                        onClick={() => {
                          setBrush((current) => ({ ...current, mode }));
                          viewport.current?.focus({ preventScroll: true });
                        }}
                      >
                        {label} <span className={classes.toolKey}>{key}</span>
                      </Button>
                    ))}
                    <label className={classes.toolLabel}>
                      {t("size")}
                      <input
                        aria-label={t("brushSize")}
                        type="range"
                        min={1}
                        max={200}
                        value={brush.radius}
                        onChange={(event) => {
                          setBrush((current) => ({
                            ...current,
                            radius: Number(event.target.value),
                          }));
                        }}
                      />
                      <span className={classes.toolKey}>{brush.radius}px</span>
                    </label>
                  </>
                )}
                {focusedObservation?.kind === "mask" && (
                  <Button
                    size="small"
                    data-tool="convert-to-polygons"
                    onClick={() => {
                      openPolygonConversion(focusedInstanceId);
                    }}
                  >
                    {t("convertPolygons")}
                  </Button>
                )}
                {focusedObservation?.kind === "polygons" && (
                  <Tooltip describeChild title={t("rasterizeHint")}>
                    <Button
                      size="small"
                      data-tool="convert-to-mask"
                      onClick={() => {
                        run(() => {
                          state.convertToMask(focusedInstanceId);
                        });
                      }}
                    >
                      {t("convertMask")}
                    </Button>
                  </Tooltip>
                )}
              </Stack>
            )}
          {state.editing &&
            !drawing &&
            active &&
            !locked &&
            activePolygonId == undefined &&
            scopePolygons.length > 1 &&
            state.viewMode !== "original" && (
              <Typography
                variant="caption"
                role="status"
                className={classes.chip}
                data-testid="choose-polygon-hint"
              >
                {t("scopePolygonsHint", { scopePolygonsCount: scopePolygons.length })}
              </Typography>
            )}
          {drawing && active && showHelp && !draftElsewhere && (
            <Alert
              severity="info"
              icon={false}
              className={classes.hint}
              onClose={() => {
                setShowHelp("hidden");
              }}
            >
              {quickMode ? t("quickHelp") : t("polygonHelp")}
            </Alert>
          )}
          {drawing && active && !showHelp && !draftElsewhere && (
            <Button
              size="small"
              onClick={() => {
                setShowHelp("shown");
              }}
            >
              {t("drawingHelp")}
            </Button>
          )}
        </Stack>
        <svg
          role="img"
          aria-label={t("framePolygons")}
          width="100%"
          height="100%"
          viewBox={`0 0 ${nativeView?.width ?? size.width} ${nativeView?.height ?? size.height}`}
          preserveAspectRatio={nativeView ? "none" : "xMidYMid meet"}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            touchAction: "none",
            cursor: panning
              ? "grabbing"
              : panTool || spaceHeld
                ? "grab"
                : drawing
                  ? "crosshair"
                  : brushActive
                    ? "none"
                    : hover?.type === "edge"
                      ? "copy"
                      : "default",
          }}
          onPointerLeave={() => {
            setHover(undefined);
            setBrushCursor(undefined);
          }}
          onDoubleClick={doubleClickMask}
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
            if (brushActive && !peekOriginal && !panTool && !space.current && event.button === 0) {
              const at = point(event);
              if (at) {
                const start = { x: clampUnit(at.x), y: clampUnit(at.y) };
                event.currentTarget.setPointerCapture(event.pointerId);
                capture.current = { element: event.currentTarget, pointerId: event.pointerId };
                drag.current = { type: "stroke", points: [start] };
                setStroke([start]);
              }
              return;
            }
            if (
              !drawing &&
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
              drawing &&
              quickMode &&
              !peekOriginal &&
              !locked &&
              state.viewMode !== "original" &&
              event.button === 0
            ) {
              addQuickPoint(event, event.shiftKey || event.altKey ? "negative" : "positive");
              return;
            }
            if (
              drawing &&
              !peekOriginal &&
              !locked &&
              state.viewMode !== "original" &&
              event.button === 0
            ) {
              const next = point(event);
              if (!next) {
                setError(t("pointerUnmapped"));
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
            if (brushActive) {
              const at = point(event);
              setBrushCursor(at);
              if (active?.type === "stroke" && at) {
                active.points.push({ x: clampUnit(at.x), y: clampUnit(at.y) });
                setStroke([...active.points]);
              }
            }
            if (active?.type === "stroke") {
              return;
            }
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
              const panel = panelView();
              if (panel) {
                // Over the Image panel, pan its camera by the pointer's screen movement.
                const last = active.last ?? active.origin;
                panel.panBy(event.clientX - last.x, event.clientY - last.y);
                active.last = { x: event.clientX, y: event.clientY };
                return;
              }
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
              !targets.every((target) => editsVertices(target.instanceId, target.polygonId))
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
            if (active?.type === "stroke") {
              const points = active.points;
              cancelGesture();
              finishStroke(points);
              return;
            }
            if (
              active?.type === "pan" &&
              active.button === 2 &&
              !active.moved &&
              !navigationLocked
            ) {
              if (drawing && quickMode && !locked && !peekOriginal) {
                addQuickPoint(event, "negative");
              } else {
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  target: contextTarget(event),
                });
              }
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
            const active = drag.current;
            if (active?.type === "stroke") {
              cancelGesture();
              finishStroke(active.points);
              return;
            }
            if (drag.current) {
              // DOM remounts (late frame-window merge, viewBox resize) can drop capture
              // before pointerup; commit the preview instead of reverting the gesture.
              commitPolygonPreview();
              resetTemporaryInput();
            }
          }}
        >
          <g
            ref={content}
            transform={
              nativeView
                ? `matrix(${nativeView.matrix.join(" ")})`
                : `translate(${pan.x} ${pan.y}) scale(${zoom})`
            }
          >
            {nativeView != undefined &&
              !disabled &&
              state.viewMode !== "original" &&
              !peekOriginal &&
              document?.instances.map((instance) => {
                const color =
                  document.classes.find((item) => item.id === instance.classId)?.color ?? "#00897b";
                const polygons =
                  frameId == undefined
                    ? []
                    : polygonsOf(document.annotations[frameInstanceKey(frameId, instance.id)]);
                const visible = polygons.filter(
                  (polygon) => state.viewMode === "all" || inFocus(instance.id, polygon.id),
                );
                return (
                  <g
                    key={instance.id}
                    data-instance-id={instance.id}
                    data-frame-id={frameId}
                    data-log-time-ns={frame?.logTimeNs}
                  >
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
                        state.editing &&
                        editsVertices(instance.id, polygon.id) &&
                        !locked &&
                        !drawing;
                      // Active polygon: thickest outline and vertices; the rest of the edit scope
                      // is highlighted; everything else is a thin outline.
                      const emphasis =
                        state.editing && !drawing && polygon.id === activePolygonId
                          ? "active"
                          : inFocus(instance.id, polygon.id)
                            ? "scope"
                            : "none";
                      return (
                        <g key={polygon.id}>
                          <path
                            d={polygonPath(points, size.width, size.height)}
                            fill="none"
                            stroke={color}
                            strokeWidth={emphasis === "active" ? 3 : emphasis === "scope" ? 2 : 1}
                            data-polygon-emphasis={emphasis}
                            data-polygon-id={polygon.id}
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
                                    aria-label={t("vertexLabel", {
                                      vertex: index + 1,
                                      polygon: polygon.id,
                                    })}
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
              editsVertices(hover.instanceId, hover.polygonId) &&
              !drawing &&
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
            {brushActive && stroke && stroke.length > 0 && (
              <path
                data-testid="brush-stroke"
                pointerEvents="none"
                d={`M ${stroke.map((p) => `${p.x * size.width} ${p.y * size.height}`).join(" L ")}`}
                fill="none"
                stroke={brush.mode === "paint" ? "#4c8dff" : "#ff5252"}
                strokeOpacity={0.5}
                strokeWidth={(2 * brush.radius * size.width) / sourceSize().width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {brushActive && brushCursor && !peekOriginal && (
              <circle
                data-testid="brush-cursor"
                pointerEvents="none"
                cx={brushCursor.x * size.width}
                cy={brushCursor.y * size.height}
                r={(brush.radius * size.width) / sourceSize().width}
                fill="none"
                stroke={brush.mode === "paint" ? "white" : "#ff5252"}
                strokeWidth={1.5 / screenScale}
                strokeDasharray={
                  brush.mode === "erase" ? `${4 / screenScale} ${3 / screenScale}` : undefined
                }
              />
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
            {drawing && quickMode && state.viewMode !== "original" && !peekOriginal && (
              <g pointerEvents="none" data-testid="quick-annotation">
                {quickResult && quickResult.w > 0 && (
                  <image
                    // eslint-disable-next-line @coscene-io/link-target -- SVG image of the mask preview, not a link.
                    href={quickResult.url}
                    x={(quickResult.x0 * size.width) / quickResult.mask.width}
                    y={(quickResult.y0 * size.height) / quickResult.mask.height}
                    width={(quickResult.w * size.width) / quickResult.mask.width}
                    height={(quickResult.h * size.height) / quickResult.mask.height}
                    preserveAspectRatio="none"
                    style={{ imageRendering: "pixelated" }}
                  />
                )}
                {quickPoints.map((p, index) => (
                  <g key={index} data-quick-point={p.positive ? "positive" : "negative"}>
                    <circle
                      cx={p.x * size.width}
                      cy={p.y * size.height}
                      r={6 / screenScale}
                      fill={p.positive ? "#00c853" : "#ff1744"}
                      stroke="white"
                      strokeWidth={1.5 / screenScale}
                    />
                    <path
                      d={
                        p.positive
                          ? `M ${p.x * size.width - 3 / screenScale} ${p.y * size.height} h ${6 / screenScale} M ${p.x * size.width} ${p.y * size.height - 3 / screenScale} v ${6 / screenScale}`
                          : `M ${p.x * size.width - 3 / screenScale} ${p.y * size.height} h ${6 / screenScale}`
                      }
                      stroke="white"
                      strokeWidth={1.5 / screenScale}
                    />
                  </g>
                ))}
              </g>
            )}
            {drawing && !quickMode && state.viewMode !== "original" && !peekOriginal && (
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
      <Dialog
        open={conversion != undefined}
        onClose={() => {
          setConversion(undefined);
        }}
        aria-labelledby="mask-conversion-title"
      >
        <DialogTitle id="mask-conversion-title">{t("convertMaskPolygons")}</DialogTitle>
        {conversion && (
          <DialogContent data-testid="mask-conversion-loss">
            <Typography variant="body2" gutterBottom>
              {t("conversionWarning")}
            </Typography>
            <Typography variant="body2" component="ul">
              <li>
                IoU {(conversion.loss.iou * 100).toFixed(2)}% ·{" "}
                {t("conversionPolygonCount", { polygonCount: conversion.loss.polygonCount })}
              </li>
              <li>
                {t("conversionPixelChange", {
                  lostPixels: conversion.loss.lostPixels,
                  addedPixels: conversion.loss.addedPixels,
                })}
              </li>
              {conversion.loss.holes > 0 && (
                <li>{t("conversionHolesFilled", { holes: conversion.loss.holes })}</li>
              )}
              {conversion.loss.droppedComponents > 0 && (
                <li>
                  {t("conversionPartsDropped", {
                    droppedComponents: conversion.loss.droppedComponents,
                  })}
                </li>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("conversionUndoHint")}
            </Typography>
          </DialogContent>
        )}
        <DialogActions>
          <Button
            onClick={() => {
              setConversion(undefined);
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            data-testid="confirm-mask-conversion"
            onClick={() => {
              const target = conversion;
              setConversion(undefined);
              if (target) {
                run(() => {
                  state.convertToPolygons(target.instanceId);
                });
              }
            }}
          >
            {t("convert")}
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        {...annotationPopupProps}
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
              if (!drawing) {
                state.setFocus({ type: "polygon", id: target.polygonId });
              }
              state.setSelection([{ type: "polygon", id: target.polygonId }]);
              setContextMenu(undefined);
            }}
          >
            {t("focusPolygon")}
          </MenuItem>
        )}
        {contextMenu?.target?.type === "vertex" && (
          <MenuItem
            disabled={
              locked ||
              !state.editing ||
              drawing != undefined ||
              contextMenu.target.points.length <= 3
            }
            onClick={() => {
              const target = contextMenu.target;
              if (target?.type === "vertex" && !locked && state.editing && !drawing) {
                removeVertexAt(target.polygonId, target.points, target.vertex);
              }
              setContextMenu(undefined);
            }}
          >
            {t("deleteVertex")}
          </MenuItem>
        )}
        {drawing && (
          <MenuItem
            disabled={locked || (quickMode ? !quickResult || quickBusy : draft.length < 3)}
            onClick={() => {
              finishDrawing();
              setContextMenu(undefined);
            }}
          >
            {quickMode ? t("finishMask") : t("finishPolygon")}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            fit();
            setContextMenu(undefined);
          }}
        >
          {t("fitImage")}
        </MenuItem>
        <MenuItem
          disabled={!state.focus}
          onClick={() => {
            fitSelection();
            setContextMenu(undefined);
          }}
        >
          {t("fitSelection")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            openKeyboardShortcuts();
            setContextMenu(undefined);
          }}
        >
          {t("keyboardShortcuts")}
        </MenuItem>
      </Menu>
    </Stack>
  );
}
