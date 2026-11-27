// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { summarizeObservation } from "./maskGeometry";
import type { FrameWindow, SegmentationDocument } from "./types";

export function frameOfKey(key: string): string {
  return (JSON.parse(key) as [string, string])[0];
}

/**
 * A read window is the authority for its frames: what it returns replaces the base's geometry,
 * summaries and unreadable entries there, and what it omits was deleted on the server. A key a
 * save rewrote after the read started (`stale`) keeps the base's post-save value instead. An
 * empty unreadable set leaves no `unreadableObservations` key, so unchanged documents compare equal.
 */
export function mergeFrameWindow(
  document: SegmentationDocument,
  frameWindow: Pick<FrameWindow, "annotations" | "unreadable">,
  frameIds: ReadonlySet<string>,
  stale: (key: string) => boolean = () => false,
): SegmentationDocument {
  const replaced = (key: string, frameId: string) => frameIds.has(frameId) && !stale(key);
  const instances = new Set(document.instances.map((instance) => instance.id));
  const annotations = { ...document.annotations };
  const annotationSummaries = { ...document.annotationSummaries };
  for (const [key, annotation] of Object.entries(document.annotations)) {
    if (replaced(key, annotation.frameId)) {
      delete annotations[key];
    }
  }
  for (const key of Object.keys(document.annotationSummaries)) {
    if (replaced(key, frameOfKey(key))) {
      delete annotationSummaries[key];
    }
  }
  for (const [key, annotation] of Object.entries(frameWindow.annotations)) {
    if (replaced(key, annotation.frameId) && instances.has(annotation.instanceId)) {
      annotations[key] = annotation;
      annotationSummaries[key] = summarizeObservation(annotation);
    }
  }
  const { unreadableObservations: current, ...rest } = document;
  const unreadable = Object.fromEntries([
    ...Object.entries(current ?? {}).filter(([key, item]) => !replaced(key, item.frameId)),
    ...Object.entries(frameWindow.unreadable ?? {}).filter(
      ([key, item]) => replaced(key, item.frameId) && instances.has(item.instanceId),
    ),
  ]);
  return {
    ...rest,
    annotations,
    annotationSummaries,
    ...(Object.keys(unreadable).length > 0 ? { unreadableObservations: unreadable } : {}),
  };
}

/**
 * The document without the geometry and unreadable entries of `frameIds`. Summaries stay, so the
 * tree keeps its presence counts; a later window read fills the geometry in again.
 */
export function evictFrames(
  document: SegmentationDocument,
  frameIds: ReadonlySet<string>,
): SegmentationDocument {
  const annotations = Object.fromEntries(
    Object.entries(document.annotations).filter(([, item]) => !frameIds.has(item.frameId)),
  );
  const { unreadableObservations: current, ...rest } = document;
  const unreadable = Object.fromEntries(
    Object.entries(current ?? {}).filter(([, item]) => !frameIds.has(item.frameId)),
  );
  return {
    ...rest,
    annotations,
    ...(Object.keys(unreadable).length > 0 ? { unreadableObservations: unreadable } : {}),
  };
}
