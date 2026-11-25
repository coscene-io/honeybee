// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { frameInstanceKey } from "../service";
import { createSegmentationStore } from "../store";
import { createMockSegmentationService } from "../testing/mockService";
import type { NormalizedPoint } from "../types";

const triangle: NormalizedPoint[] = [
  { x: 0.12345, y: 0.2 },
  { x: 0.4, y: 0.2 },
  { x: 0.3, y: 0.6 },
];

/**
 * A large document is costly to deep clone and its masks costly to decode. Edits and propagated
 * frames keep every untouched observation and summary by identity: nothing was cloned, replayed
 * or re-summarized for them.
 */
async function loadedStore() {
  const service = createMockSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
    mockMasks: { seed: 7, instances: 3, cameras: 1 },
  });
  const store = createSegmentationStore(service);
  await store.getState().initialize();
  // One window: a few hundred observations show identity is kept, without the cost of more on CI.
  await store.getState().loadFrameWindow("video-1", 0, 10);
  return store;
}

describe("store performance", () => {
  it("stages edits without cloning or re-summarizing untouched observations", async () => {
    const store = await loadedStore();
    const before = store.getState().document!;
    const keys = Object.keys(before.annotations);
    expect(keys.length).toBeGreaterThan(200);
    expect(Object.values(before.annotations).some((item) => item.kind === "mask")).toBe(true);
    const edited = frameInstanceKey("frame-0", "instance-1");
    for (let index = 0; index < 20; index++) {
      store.getState().renameClass("class-1", `Renamed ${index}`);
    }
    store.getState().addPolygon("instance-1", triangle);
    const after = store.getState().document!;
    for (const key of keys) {
      if (key !== edited) {
        expect(after.annotations[key]).toBe(before.annotations[key]);
        expect(after.annotationSummaries[key]).toBe(before.annotationSummaries[key]);
      }
    }
    expect(after.annotations[edited]).not.toBe(before.annotations[edited]);
    store.getState().dispose();
  });

  it("streams propagated frames without cloning the rest of the document", async () => {
    const store = await loadedStore();
    const before = store.getState().document!;
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: "frame-0",
      endTimeNs: "1700000004000000000",
    });
    expect(store.getState().propagation).toMatchObject({
      status: "completed",
      processedFrames: 20,
    });
    const after = store.getState().document!;
    const propagated = new Set(
      Array.from({ length: 20 }, (_, index) =>
        frameInstanceKey(`frame-${index + 1}`, "instance-1"),
      ),
    );
    for (const key of Object.keys(before.annotations)) {
      if (!propagated.has(key)) {
        expect(after.annotations[key]).toBe(before.annotations[key]);
      }
    }
    store.getState().dispose();
  });
});
