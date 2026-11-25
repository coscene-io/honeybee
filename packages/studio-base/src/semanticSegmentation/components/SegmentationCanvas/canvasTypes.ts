// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { RefObject } from "react";
import type { StoreApi } from "zustand";

import type { EditorPoint } from "../../editorGeometry";
import type { DecodedSegmentationFrame } from "../../runtime";
import type { SegmentationMask, SemanticSegmentationStore } from "../../types";

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

export type VertexRef = { polygonId: string; vertex: number };

export type VertexGroup = {
  instanceId: string;
  polygonId: string;
  points: EditorPoint[];
  indices: number[];
};

/** Polygon points shown while a drag is in flight, by polygon id. */
export type Preview = Record<string, EditorPoint[]>;

export type Drag =
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

export type PolygonTarget = {
  type: "polygon";
  instanceId: string;
  polygonId: string;
  points: EditorPoint[];
};

export type HoverTarget = { instanceId: string; polygonId: string; points: EditorPoint[] } & (
  { type: "vertex"; vertex: number } | { type: "edge"; after: number; point: EditorPoint }
);

export type ContextMenuState = {
  x: number;
  y: number;
  keyboard?: boolean;
  target?: HoverTarget | PolygonTarget;
};

/** A vertex of an editable polygon, with the polygon it belongs to. */
export type EditableVertex = {
  instanceId: string;
  polygonId: string;
  vertex: number;
  point: EditorPoint;
  points: EditorPoint[];
};

/** Brush/eraser for mask observations; the radius is in source pixels. */
export type Brush = { mode: "paint" | "erase"; radius: number };

/** The SAM result shown while the quick tool is active. */
export type QuickResult = {
  mask: SegmentationMask;
  score: number;
  url: string;
  x0: number;
  y0: number;
  w: number;
  h: number;
};
