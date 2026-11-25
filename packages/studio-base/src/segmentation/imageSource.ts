// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec, type Time } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import type { PlayerURLState } from "@foxglove/studio-base/players/types";

import type { SharedMaskPlanes } from "./maskOverlay/sharedMaskPlanes";
import type { NativeImageView } from "./nativeImageTransform";

/** Frame identity and projection of a displayed image. */
export type SegmentationImageMetadata = Readonly<{
  nativeView?: NativeImageView;
  /** Decoded size of the displayed source frame; masks of this topic decode at this size. */
  imageWidth?: number;
  imageHeight?: number;
  topic: string;
  /** Both stamps belong to the message whose pixels have actually been displayed. */
  timestamp: Time;
  receiveTime: Time;
  decodedIdentity: object;
}>;

export type SegmentationImage = SegmentationImageMetadata &
  Readonly<{
    /**
     * A PNG data URL of the displayed pixels. Encoding is synchronous and costly: it happens on the
     * first call for a decoded frame and the result is kept for that frame.
     */
    encodeImageUrl: () => string;
  }>;

export type SegmentationImageSource = () => SegmentationImage | undefined;

/**
 * The Image panel's own camera, for an annotation canvas laid over it. Points are client (CSS)
 * pixels; zoom ratios multiply the current zoom around that point; pan moves by screen pixels.
 */
export type SegmentationViewControls = {
  reset: () => void;
  zoom: (ratio: number, clientX: number, clientY: number) => void;
  panBy: (dx: number, dy: number) => void;
  /** Hands the renderer a wheel gesture made on the canvas laid over it. */
  wheel: (event: WheelEvent) => void;
  /** Hands the renderer a mouse press made on the canvas laid over it, so it can pan with it. */
  mouseDown: (event: MouseEvent) => void;
};

/** What the Image renderer, which lives in its own React root, shares with the editor. */
export type SegmentationRendererSources = {
  /** Frame identity and projection of the displayed image, without a PNG copy of its pixels. */
  imageMetadata: () => SegmentationImageMetadata | undefined;
  /** The displayed image; its PNG is encoded only when asked for. */
  image: SegmentationImageSource;
  viewControls: SegmentationViewControls;
  /** Where the renderer draws, in client coordinates. */
  bounds: () => DOMRectReadOnly;
  /** Frames the panel's decoder cache still holds. */
  cachedFrames: () => MessageEvent[];
};

export function imageFrameIdentity(
  image: Pick<SegmentationImage, "timestamp" | "receiveTime">,
): string {
  return `${toNanoSec(image.timestamp)}:${toNanoSec(image.receiveTime)}`;
}

/** Player IDs fence live bindings, while persisted annotations use reproducible source identity. */
export function segmentationSourceKey({
  dataAssetName,
  filename,
  sizeBytes,
  urlState,
  playerId,
}: {
  dataAssetName?: string;
  filename?: string;
  sizeBytes?: string;
  urlState?: PlayerURLState;
  playerId: string;
}): string {
  if (dataAssetName) {
    return dataAssetName;
  }
  const parameters = Object.entries(urlState?.parameters ?? {})
    .filter(([key]) => key !== "topic")
    .sort(([a], [b]) => a.localeCompare(b));
  // URL parameters identify the source; without any, a file name does, then the bare source.
  if (urlState && (parameters.length > 0 || !filename)) {
    return JSON.stringify([urlState.sourceId, parameters])!;
  }
  if (filename) {
    return JSON.stringify(["file", urlState?.sourceId, filename, sizeBytes])!;
  }
  return `transient:${playerId}`;
}

/**
 * Geometry of every mask observation on one source frame, in slot order. `id` changes only when
 * the geometry does (never for style), so decoded bit planes stay cached across unrelated edits.
 */
export type SegmentationMaskGeometry = Readonly<{
  id: number;
  topic: string;
  logTimeNs: string;
  width: number;
  height: number;
  instanceIds: readonly string[];
  counts: readonly string[];
}>;

/** Per-slot presentation. Hidden instances keep their bits; only the shader skips them. */
export type SegmentationMaskStyle = Readonly<{
  /** sRGB 0-1, one triple per slot. */
  colors: readonly (readonly [number, number, number])[];
  visible: readonly boolean[];
  selected: readonly boolean[];
  opacity: number;
}>;

export type SegmentationMaskOverlaySource = {
  /** Masks of exactly this topic + MCAP log time (decimal ns); undefined when there are none. */
  frame: (
    topic: string,
    logTimeNs: string,
  ) => { geometry: SegmentationMaskGeometry; style: SegmentationMaskStyle } | undefined;
  /**
   * Geometry of the source frames after logTimeNs, for off-thread prefetch: at least minFrames,
   * then every frame up to horizonNs ahead, never more than maxFrames.
   */
  upcoming: (
    topic: string,
    logTimeNs: string,
    range: { minFrames: number; maxFrames: number; horizonNs: bigint },
  ) => SegmentationMaskGeometry[];
};

/** The masks the editor publishes for every Image panel to draw. */
export type SegmentationMaskOverlay = {
  get: () => SegmentationMaskOverlaySource | undefined;
  set: (source: SegmentationMaskOverlaySource | undefined) => void;
  /** Content or style changed: renderers re-query on their next frame. */
  invalidate: () => void;
  subscribe: (listener: () => void) => () => void;
};

/** A new, empty overlay channel. One per `SegmentationHost`. */
export function createSegmentationMaskOverlay(): SegmentationMaskOverlay {
  let source: SegmentationMaskOverlaySource | undefined;
  const listeners = new Set<() => void>();
  const overlay: SegmentationMaskOverlay = {
    get: () => source,
    set(next) {
      source = next;
      overlay.invalidate();
    },
    invalidate() {
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return overlay;
}

/**
 * What one Image panel's renderer and the segmentation editor exchange. The renderer lives in its
 * own React root (a panel extension), so context cannot reach it: the panel's adapter creates this
 * object and hands it to the renderer explicitly. The overlay and plane cache are the host's, shared
 * by all panels; the sources are this panel's own.
 */
export type SegmentationPanelBridge = {
  /** Masks to draw, from the host. */
  maskOverlay: SegmentationMaskOverlay;
  /** The CPU mask-plane cache shared by every panel of the host. */
  maskPlanes: SharedMaskPlanes;
  /** Renderer side: offer this panel's image and camera; the returned function withdraws them. */
  publish: (sources: SegmentationRendererSources) => () => void;
  /** Editor side: what the renderer currently offers. */
  sources: () => SegmentationRendererSources | undefined;
  /** Editor side: calls `listener` after each frame the renderer draws. */
  subscribeFrames: (listener: () => void) => () => void;
  /** Renderer side: a frame was drawn. */
  notifyFrame: () => void;
};

export function createSegmentationPanelBridge(
  shared: Pick<SegmentationPanelBridge, "maskOverlay" | "maskPlanes">,
): SegmentationPanelBridge {
  let current: SegmentationRendererSources | undefined;
  const frameListeners = new Set<() => void>();
  return {
    ...shared,
    publish(sources) {
      current = sources;
      return () => {
        if (current === sources) {
          current = undefined;
        }
      };
    },
    sources: () => current,
    subscribeFrames(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    notifyFrame() {
      // A listener may subscribe again while it runs; it then waits for the next frame.
      for (const listener of [...frameListeners]) {
        listener();
      }
    },
  };
}
