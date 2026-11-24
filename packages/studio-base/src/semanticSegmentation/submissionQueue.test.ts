// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "./maskGeometry";
import { frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import { createMockSemanticSegmentationService } from "./testing/mockService";
import type { NormalizedPoint, SubmitRequest } from "./types";

const triangle: NormalizedPoint[] = [
  { x: 0.12345, y: 0.2 },
  { x: 0.4, y: 0.2 },
  { x: 0.3, y: 0.6 },
];
const moved = triangle.map((point) => ({ x: point.x + 0.05, y: point.y }));
const key = frameInstanceKey("frame-0", "instance-1");

async function setup() {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const sent: SubmitRequest[] = [];
  const submit = service.submit.bind(service);
  service.submit = async (request) => {
    sent.push(request);
    return await submit(request);
  };
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  return { service, store, sent };
}

describe("a failed submission", () => {
  it("holds the batches after it, so a dependent batch never reaches the server first", async () => {
    const { service, store, sent } = await setup();
    const classId = store.getState().addClass("Created in the first batch");
    service.setControls({ failNext: true });
    const first = store.getState().submit("create class")!;
    await store.getState().waitForSubmissions();
    // Built on the class the failed batch creates.
    store.getState().addInstance(classId);
    store.getState().submit("instance of that class");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "failed",
      "queued",
    ]);
    expect(sent).toHaveLength(1);
    store.getState().retrySubmission(first);
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(sent.map((request) => request.message)).toEqual([
      "create class",
      "create class",
      "instance of that class",
    ]);
    store.getState().dispose();
  });

  it("never shows its stale geometry over a later edit of the same polygon", async () => {
    const { service, store } = await setup();
    const polygonId = store.getState().addPolygon("instance-1", triangle);
    service.setControls({ failNext: true });
    store.getState().submit("first shape");
    await store.getState().waitForSubmissions();
    store.getState().setPolygonPoints(polygonId, moved);
    store.getState().submit("moved");
    await store.getState().waitForSubmissions();
    const points = () =>
      polygonsOf(store.getState().document!.annotations[key]).find(
        (polygon) => polygon.id === polygonId,
      )!.points;
    // The later edit is held behind the failure, and the overlay replays both in order.
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
      "failed",
      "queued",
    ]);
    expect(points()).toEqual(moved);
    store.getState().dispose();
  });

  it("can be discarded; the held batches return to staging to submit again", async () => {
    const { service, store, sent } = await setup();
    store.getState().renameClass("class-1", "Lost");
    service.setControls({ failNext: true });
    const failed = store.getState().submit("rename")!;
    await store.getState().waitForSubmissions();
    const polygonId = store.getState().addPolygon("instance-1", triangle);
    store.getState().submit("held");
    await store.getState().waitForSubmissions();
    store.getState().addClass("Newest");
    expect(() => {
      store.getState().discardSubmission("unknown");
    }).toThrow("Only failed");

    store.getState().discardSubmission(failed);
    expect(store.getState().submissionQueue).toEqual([]);
    expect(store.getState().stagedOperations.map((operation) => operation.labelKey)).toEqual([
      "opLabelCreatePolygon",
      "opLabelCreateClass",
    ]);
    const document = store.getState().document!;
    expect(document.classes.find((item) => item.id === "class-1")?.name).not.toBe("Lost");
    expect(polygonsOf(document.annotations[key]).some((polygon) => polygon.id === polygonId)).toBe(
      true,
    );
    expect(sent).toHaveLength(1);

    store.getState().submit("again");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual(["succeeded"]);
    store.getState().dispose();
  });
});

it("lists only the most recent acknowledged batches", async () => {
  const { store } = await setup();
  for (let index = 0; index < 8; index++) {
    store.getState().addClass(`Class ${index}`);
    store.getState().submit(`batch ${index}`);
  }
  await store.getState().waitForSubmissions();
  expect(store.getState().submissionQueue.map((batch) => batch.message)).toEqual([
    "batch 3",
    "batch 4",
    "batch 5",
    "batch 6",
    "batch 7",
  ]);
  store.getState().dispose();
});
