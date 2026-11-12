// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, type RenderResult } from "@testing-library/react";

import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SpatialTree } from "../../components/SpatialTree";
import { createMockSemanticSegmentationService, createSeedDocument } from "../../mockService";
import { frameInstanceKey } from "../../service";
import { createSemanticSegmentationStore } from "../../store";
import type { NormalizedPoint, SegmentationDocument, SegmentationPolygon } from "../../types";

export const triangle: NormalizedPoint[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.3, y: 0.1 },
  { x: 0.3, y: 0.3 },
];

export function fixture(frameCount = 20): SegmentationDocument {
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, frameCount);
  document.videos[0]!.durationSec = frameCount / 5;
  document.annotations = Object.fromEntries(
    Object.entries(document.annotations).filter(([, value]) =>
      document.frames.some((frame) => frame.id === value.frameId),
    ),
  );
  document.annotationSummaries = Object.fromEntries(
    Object.entries(document.annotations).map(([key, value]) => [
      key,
      {
        polygonCount: value.polygons.length,
        pointCount: value.polygons.reduce((n, polygon) => n + polygon.points.length, 0),
      },
    ]),
  );
  document.versions = Object.fromEntries(Object.keys(document.annotations).map((key) => [key, 1]));
  return document;
}

export async function setup(document = fixture()): Promise<{
  service: ReturnType<typeof createMockSemanticSegmentationService>;
  store: ReturnType<typeof createSemanticSegmentationStore>;
}> {
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

export async function editor(
  document = fixture(),
): Promise<Awaited<ReturnType<typeof setup>> & RenderResult> {
  const result = await setup(document);
  // jsdom has no SVG layout or pointer capture. Only these browser boundaries are supplied.
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  return {
    ...result,
    ...render(
      <>
        <SpatialTree store={result.store} />
        <SegmentationCanvas store={result.store} />
      </>,
    ),
  };
}

export function polygon(
  store: Awaited<ReturnType<typeof setup>>["store"],
  instanceId = "instance-1",
  frameId = "frame-0",
): SegmentationPolygon {
  return store.getState().document!.annotations[frameInstanceKey(frameId, instanceId)]!
    .polygons[0]!;
}

export function pointer(target: Element, type: string, x: number, y: number): void {
  fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
}

export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
