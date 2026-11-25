// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen, type RenderResult } from "@testing-library/react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import { PropagationForm } from "../../components/PropagationForm";
import { SegmentationCanvas } from "../../components/SegmentationCanvas/SegmentationCanvas";
import { SegmentationTree } from "../../components/SegmentationTree/SegmentationTree";
import { polygonsOf, summarizeObservation } from "../../maskGeometry";
import { buildCanvasPropagationScope } from "../../propagationSeeds";
import type { DecodedSegmentationFrame } from "../../runtime";
import { frameInstanceKey } from "../../service";
import { createSegmentationStore } from "../../store";
import { render, installSegmentationTestHost } from "../../testing/host";
import { createMockSegmentationService, createSeedDocument } from "../../testing/mockService";
import { nativeFrame, TEST_DECODED_FRAME } from "../../testing/nativeFrame";
import type {
  NormalizedPoint,
  SegmentationDocument,
  SegmentationPolygon,
  SegmentationStore,
} from "../../types";

// Every test that uses these helpers renders inside a fresh segmentation host.
installSegmentationTestHost();

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
    Object.entries(document.annotations).map(([key, value]) => [key, summarizeObservation(value)]),
  );
  return document;
}

export async function setup(document = fixture()): Promise<{
  service: ReturnType<typeof createMockSegmentationService>;
  store: ReturnType<typeof createSegmentationStore>;
}> {
  const service = createMockSegmentationService({
    document,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

export async function editor(document = fixture()): Promise<
  Awaited<ReturnType<typeof setup>> &
    RenderResult & {
      /** Decodes the shown frame at another size, as the Image panel would. */
      resize: (width: number, height: number) => void;
    }
> {
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
  const view = (frame: DecodedSegmentationFrame) => (
    <>
      <SegmentationTree store={result.store} />
      <SegmentationCanvas decodedFrame={frame} store={result.store} />
    </>
  );
  const rendered = render(view(TEST_DECODED_FRAME));
  return {
    ...result,
    ...rendered,
    resize: (width, height) => {
      act(() => {
        rendered.rerender(view(nativeFrame(width, height)));
      });
    },
  };
}

/** Vertices of the polygon being drawn, read from the canvas. */
export function draftVertexCount(): number {
  const points = screen
    .getByRole("img", { name: "Frame polygons" })
    .querySelector("polyline")
    ?.getAttribute("points")
    ?.trim();
  return points ? points.split(/\s+/).length : 0;
}

export function polygon(
  store: Awaited<ReturnType<typeof setup>>["store"],
  instanceId = "instance-1",
  frameId = "frame-0",
): SegmentationPolygon {
  return polygonsOf(
    store.getState().document!.annotations[frameInstanceKey(frameId, instanceId)],
  )[0]!;
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

/** The canvas propagation popover's form, scoped to the store's current frame. */
export function CurrentFramePropagationForm({
  store,
}: {
  store: StoreApi<SegmentationStore>;
}): React.JSX.Element {
  const state = useStore(store);
  return (
    <PropagationForm
      store={store}
      scope={buildCanvasPropagationScope(state.document, state.currentFrameId)}
    />
  );
}
