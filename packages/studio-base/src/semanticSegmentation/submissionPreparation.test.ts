// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSegmentationRuntime } from "./runtime";
import { frameInstanceKey } from "./service";
import { createSubmissionFixture, stageSubmissionFixture } from "./submissionFixture";
import { prepareSubmission } from "./submissionPreparation";
import type { SubmitRequest } from "./types";

const turn = async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};
async function setup() {
  const runtime = createSegmentationRuntime(createSubmissionFixture());
  runtime.service.setControls({ delayMs: 0 });
  await stageSubmissionFixture(runtime);
  return runtime;
}

it("prepares 1000 frames cooperatively, keeps click snapshots and later edits separate, and preserves FIFO/CAS rebase", async () => {
  const runtime = await setup();
  const state = runtime.store.getState();
  const originalSubmit = runtime.service.submit.bind(runtime.service);
  const requests: SubmitRequest[] = [];
  let releaseFirst: (() => void) | undefined;
  runtime.service.submit = async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return await originalSubmit(request);
  };
  const first = state.submit("1000 frame snapshot");
  expect(state.submit("duplicate click")).toBeUndefined();
  expect(runtime.store.getState().submissionQueue).toHaveLength(1);
  expect(runtime.store.getState().submissionQueue[0]?.status).toBe("preparing");
  expect(requests).toHaveLength(0);
  const key = frameInstanceKey("submission-frame-1", "instance-1");
  runtime.store.getState().setCurrentFrame("submission-frame-1");
  const polygon = runtime.store.getState().document!.annotations[key]!.polygons[0]!;
  const frozenPoints = polygon.points.map((point) => ({ ...point }));
  runtime.store.getState().setPolygonPoints(
    polygon.id,
    polygon.points.map((point) => ({ ...point, x: point.x + 0.01 })),
  );
  const second = runtime.store.getState().submit("later edit");
  const originalSecond = runtime.store.getState().submissionQueue[1]!.operations;
  runtime.store.getState().addClass("After both clicks");
  for (let i = 0; i < 500 && !releaseFirst; i++) {
    await turn();
  }
  expect(releaseFirst).toBeDefined();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.id).toBe(first);
  expect(Object.keys(requests[0]!.expectedVersions)).toHaveLength(1000);
  expect(requests[0]?.expectedVersions[key]).toBe(1);
  const firstChanges = requests[0]!.operations[0]!.patch.polygonChanges![key]!;
  expect(firstChanges.polygons[polygon.id]?.points).toEqual(frozenPoints);
  expect(Object.isFrozen(requests[0]!.operations[0]!.patch)).toBe(true);
  releaseFirst?.();
  await runtime.store.getState().waitForSubmissions();
  expect(requests.map((request) => request.id)).toEqual([first, second]);
  expect(requests[1]?.expectedVersions[key]).toBe(2);
  expect(originalSecond[0]?.expectedVersions[key]).toBe(1);
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  expect(
    runtime.store.getState().document?.classes.some((item) => item.name === "After both clicks"),
  ).toBe(true);
  expect(runtime.store.getState().submissionQueue.map((batch) => batch.status)).toEqual([
    "succeeded",
    "succeeded",
  ]);
  runtime.dispose();
});

it("does not send or mutate the batch after disposal during preparation", async () => {
  const runtime = await setup();
  let sent = 0;
  runtime.service.submit = async () => {
    sent++;
    throw new Error("Must not send after dispose");
  };
  runtime.store.getState().submit("dispose during prepare");
  await turn();
  await turn();
  runtime.dispose();
  const disposed = runtime.store.getState();
  await disposed.waitForSubmissions();
  expect(sent).toBe(0);
  expect(runtime.store.getState()).toBe(disposed);
});

it("preserves explicit undefined deletion values and prototype-shaped IDs while yielding scope enumeration", async () => {
  const document = createSubmissionFixture();
  const patch = {
    classes: Object.fromEntries([["__proto__", undefined]]),
    instances: { "instance-1": undefined },
    instanceMerges: { "instance-1": "instance-2" },
  };
  let pulses = 0;
  let alive = true;
  const pulse = () => {
    if (alive) {
      pulses++;
      setTimeout(pulse, 0);
    }
  };
  setTimeout(pulse, 0);
  const prepared = await prepareSubmission(
    [{ id: "delete", label: "Delete and merge", patch, expectedVersions: {} }],
    document,
    () => {},
    () => false,
  ).finally(() => {
    alive = false;
  });
  expect(pulses).toBeGreaterThan(2);
  expect(
    Object.prototype.hasOwnProperty.call(prepared.operations[0]!.patch.classes, "__proto__"),
  ).toBe(true);
  expect(prepared.operations[0]!.patch.classes!.__proto__).toBeUndefined();
  expect(Object.getPrototypeOf(prepared.operations[0]!.patch.classes)).toBe(Object.prototype);
  expect(Object.keys(prepared.expectedVersions)).toHaveLength(2002);
  expect(prepared.expectedVersions[frameInstanceKey("submission-frame-1000", "instance-1")]).toBe(
    1,
  );
  expect(prepared.expectedVersions[frameInstanceKey("submission-frame-1000", "instance-2")]).toBe(
    0,
  );
});
