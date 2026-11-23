// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec, type Time } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import type { PlayerURLState } from "@foxglove/studio-base/players/types";

import type { NativeImageView } from "./nativeImageTransform";

export type SegmentationImage = Readonly<{
  imageUrl: string;
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

export type SegmentationImageMetadata = Omit<SegmentationImage, "imageUrl">;
export type SegmentationImageSource = () => SegmentationImage | undefined;

/** Read-only overlays need frame identity and projection, not a PNG copy of the pixels. */
export const segmentationImageMetadataSources = new WeakMap<
  HTMLCanvasElement,
  () => SegmentationImageMetadata | undefined
>();

/** Bridges the Image renderer's separate React root to its enclosing coStudio panel. */
export const segmentationImageSources = new WeakMap<HTMLCanvasElement, SegmentationImageSource>();

/**
 * The Image panel's own camera, for an annotation canvas laid over it. Points are client (CSS)
 * pixels; zoom ratios multiply the current zoom around that point; pan moves by screen pixels.
 */
export type SegmentationViewControls = {
  reset: () => void;
  zoom: (ratio: number, clientX: number, clientY: number) => void;
  panBy: (dx: number, dy: number) => void;
};
export const segmentationViewControls = new WeakMap<HTMLCanvasElement, SegmentationViewControls>();

/** Frames the panel's decoder cache still holds, keyed by the same canvas as the capture. */
export const segmentationCachedFrames = new WeakMap<HTMLCanvasElement, () => MessageEvent[]>();

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

let maskOverlaySource: SegmentationMaskOverlaySource | undefined;
const maskOverlayListeners = new Set<() => void>();

/**
 * The Image renderer lives in its own React root; the segmentation layer publishes masks here and
 * every ImageMode reads them on its own render frame, after it committed the displayed image.
 */
export const segmentationMaskOverlay = {
  get: (): SegmentationMaskOverlaySource | undefined => maskOverlaySource,
  set(source: SegmentationMaskOverlaySource | undefined): void {
    maskOverlaySource = source;
    segmentationMaskOverlay.invalidate();
  },
  /** Content or style changed: renderers re-query on their next frame. */
  invalidate(): void {
    for (const listener of maskOverlayListeners) {
      listener();
    }
  },
  subscribe(listener: () => void): () => void {
    maskOverlayListeners.add(listener);
    return () => {
      maskOverlayListeners.delete(listener);
    };
  },
};
