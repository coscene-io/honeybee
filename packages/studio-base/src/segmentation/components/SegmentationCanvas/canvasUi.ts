// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { TFunction } from "i18next";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { StoreApi } from "zustand";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

import type { CanvasDerived } from "./canvasDerive";
import type { CanvasState } from "./canvasState";
import type {
  Brush,
  ContextMenuState,
  Drag,
  HoverTarget,
  Preview,
  QuickResult,
  SegmentationCanvasProps,
  VertexRef,
} from "./canvasTypes";
import type { EditorPoint } from "../../editorGeometry";
import type { QuickPoint } from "../../quickSegment";
import type { SegmentationHost } from "../../segmentationHostContext";
import type { MaskConversionLoss, SegmentationStore } from "../../types";

/** Dismissing the drawing help is remembered; it is a one-line hint, not a per-drawing banner. */
function useDrawingHelp(): [boolean, (value: "shown" | "hidden") => void] {
  const [stored, setStored] = useAppConfigurationValue<boolean>(
    AppSetting.SEGMENTATION_DRAWING_HELP,
  );
  const set = (value: "shown" | "hidden") => {
    void setStored(value === "shown");
  };
  return [stored ?? true, set];
}

/** Zoom, pan and the other view-only state of the canvas. */
function useViewState(viewportRef: SegmentationCanvasProps["viewportRef"]) {
  const content = useRef<SVGGElement>(ReactNull);
  const localViewport = useRef<HTMLDivElement>(ReactNull);
  const viewport: RefObject<HTMLDivElement | ReactNull> = viewportRef ?? localViewport;
  const [size, setSize] = useState({ width: 960, height: 540 });
  const [zoom, setZoom] = useState(1);
  const [screenScale, setScreenScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panTool, setPanTool] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  view.current = { zoom, pan };
  return {
    content,
    viewport,
    size,
    setSize,
    zoom,
    setZoom,
    screenScale,
    setScreenScale,
    pan,
    setPan,
    panTool,
    setPanTool,
    toolsOpen,
    setToolsOpen,
    opacity,
    setOpacity,
    view,
  };
}

/** The gesture in flight and the previews it draws. */
function useGestureState() {
  const drag = useRef<Drag | undefined>(undefined);
  const capture = useRef<{ element: SVGElement; pointerId: number } | undefined>(undefined);
  const previewRef = useRef<Preview | undefined>(undefined);
  const [preview, setPreview] = useState<Preview>();
  const [hover, setHover] = useState<HoverTarget>();
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ a: EditorPoint; b: EditorPoint }>();
  const [stroke, setStroke] = useState<EditorPoint[]>();
  const [brushCursor, setBrushCursor] = useState<EditorPoint>();
  return {
    drag,
    capture,
    previewRef,
    preview,
    setPreview,
    hover,
    setHover,
    panning,
    setPanning,
    marquee,
    setMarquee,
    stroke,
    setStroke,
    brushCursor,
    setBrushCursor,
  };
}

/** Held-key modes: Space pans, O peeks at the original image. */
function useTemporaryState() {
  const space = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [peekOriginal, setPeekOriginal] = useState(false);
  return { space, spaceHeld, setSpaceHeld, peekOriginal, setPeekOriginal };
}

/** The drawing, selection, quick-mask and notice state of the canvas. */
function useEditState() {
  // Selected vertices, oldest first; the last one is the "active" point (context menu, footer).
  const [selectedVertices, setSelectedVertices] = useState<VertexRef[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [draft, setDraft] = useState<EditorPoint[]>([]);
  const [quickPoints, setQuickPoints] = useState<QuickPoint[]>([]);
  const [quickResult, setQuickResult] = useState<QuickResult>();
  const [quickBusy, setQuickBusy] = useState(false);
  const quickRequest = useRef<AbortController | undefined>(undefined);
  const [showHelp, setShowHelp] = useDrawingHelp();
  const [error, setError] = useState<string>();
  /** A representation change the last command made (e.g. polygons rasterized into a mask). */
  const [notice, setNotice] = useState<string>();
  const [brush, setBrush] = useState<Brush>({ mode: "paint", radius: 12 });
  const [conversion, setConversion] = useState<
    { instanceId: string; loss: MaskConversionLoss } | undefined
  >();
  return {
    selectedVertices,
    setSelectedVertices,
    contextMenu,
    setContextMenu,
    draft,
    setDraft,
    quickPoints,
    setQuickPoints,
    quickResult,
    setQuickResult,
    quickBusy,
    setQuickBusy,
    quickRequest,
    showHelp,
    setShowHelp,
    error,
    setError,
    notice,
    setNotice,
    brush,
    setBrush,
    conversion,
    setConversion,
  };
}

export type CanvasUi = {
  root: RefObject<HTMLDivElement | ReactNull>;
} & ReturnType<typeof useViewState> &
  ReturnType<typeof useGestureState> &
  ReturnType<typeof useTemporaryState> &
  ReturnType<typeof useEditState>;

/** All local state of the canvas, grouped by concern. */
export function useCanvasUi(viewportRef: SegmentationCanvasProps["viewportRef"]): CanvasUi {
  const root = useRef<HTMLDivElement>(ReactNull);
  return {
    root,
    ...useViewState(viewportRef),
    ...useGestureState(),
    ...useTemporaryState(),
    ...useEditState(),
  };
}

/** What every canvas handler reads: props, store state, local state and what follows from them. */
export type CanvasContext = {
  store: StoreApi<SegmentationStore>;
  /** The workspace's shared session (which canvas holds the edit, the stroke in progress). */
  host: SegmentationHost;
  /** Opens the keyboard shortcuts dialog. */
  openShortcuts: () => void;
  props: SegmentationCanvasProps;
  state: CanvasState;
  ui: CanvasUi;
  d: CanvasDerived;
  t: TFunction<"segmentation">;
};
