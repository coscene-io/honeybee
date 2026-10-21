// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AnnotationSession } from "./AnnotationSession";
import { AnnotationConflict, MockAnnotationService } from "./MockAnnotationService";
import {
  AnnotationDocument,
  annotationTime,
  emptyDocument,
  isAnnotationFrameReady,
  nearestAnnotationFrame,
} from "./model";

function addObject(document: AnnotationDocument): void {
  document.classes.push({ id: "class", name: "Vehicle", color: "#50c7f2" });
  document.instances.push({ id: "instance", name: "Car 1", classId: "class" });
  document.frames["2"] = [
    {
      id: "polygon",
      instanceId: "instance",
      points: [
        { x: 0.1, y: 2.3 },
        { x: 10, y: 2 },
        { x: 10, y: 20 },
      ],
    },
  ];
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it("round-trips the 10 FPS grid without epoch-float precision loss and rejects stale/future images", () => {
  const start = 1_792_518_400_987_654_321n;
  expect(annotationTime(123, start)).toBe(start + 12_300_000_000n);
  expect(nearestAnnotationFrame(start + 149_999_999n, start)).toBe(1);
  expect(nearestAnnotationFrame(start + 150_000_000n, start)).toBe(2);
  expect(isAnnotationFrameReady(start + 100_000_000n, start + 1n)).toBe(true);
  expect(isAnnotationFrameReady(start + 100_000_000n, start)).toBe(false);
  expect(isAnnotationFrameReady(start, start + 1n)).toBe(false);
  expect(isAnnotationFrameReady(start, undefined)).toBe(false);
});

it("isolates scopes, validates ownership, preserves history and makes identical retries idempotent", async () => {
  const service = new MockAnnotationService(0);
  const document = emptyDocument();
  addObject(document);
  const request = {
    scope: "record/camera",
    expectedRevision: 0,
    requestId: "commit-1",
    document,
    message: "First",
  };
  const commit = service.commit(request);
  document.frames["2"]![0]!.points[0]!.x = 99;
  await jest.runAllTimersAsync();
  expect((await commit).document.frames["2"]![0]!.points[0]!.x).toBe(0.1);
  const original = await service.read("record/camera");
  const retry = service.commit({ ...request, document: original.document });
  await jest.runAllTimersAsync();
  expect((await retry).revision).toBe(1);
  const detached = await service.read("record/camera");
  detached.document.classes[0]!.name = "Changed outside service";
  expect((await service.read("record/camera")).document.classes[0]!.name).toBe("Vehicle");
  expect((await service.read("other/camera")).revision).toBe(0);
  expect(await service.history("record/camera")).toHaveLength(2);
  const invalid = service.commit({
    ...request,
    requestId: "invalid",
    expectedRevision: 1,
    document: { classes: [], instances: [], frames: original.document.frames },
  });
  const failure = invalid.catch((error: unknown) => error);
  await jest.runAllTimersAsync();
  expect(String(await failure)).toContain("Polygon needs");
});

it("keeps newer edits while submitting, serializes snapshots, supports undo/redo and restores as a new revision", async () => {
  const service = new MockAnnotationService(25);
  const session = new AnnotationSession(service, "scope");
  await session.load();
  session.edit(addObject);
  session.submit();
  session.edit((document) => {
    document.frames["2"]![0]!.points[0]!.x = 5.5;
  });
  await jest.advanceTimersByTimeAsync(25);
  expect(session.getSnapshot().dirty).toBe(true);
  expect(session.getSnapshot().document.frames["2"]![0]!.points[0]!.x).toBe(5.5);
  expect((await service.read("scope")).document.frames["2"]![0]!.points[0]!.x).toBe(0.1);
  session.submit();
  session.edit((document) => {
    document.classes[0]!.name = "Truck";
  });
  session.submit();
  session.submit();
  expect(session.getSnapshot().jobs).toHaveLength(3);
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().saved.revision).toBe(3);
  expect(session.getSnapshot().dirty).toBe(false);
  session.undo();
  expect(session.getSnapshot().document.classes[0]!.name).toBe("Vehicle");
  session.redo();
  expect(session.getSnapshot().document.classes[0]!.name).toBe("Truck");
  const restore = session.rollback(1);
  await jest.runAllTimersAsync();
  await restore;
  expect(session.getSnapshot().saved.revision).toBe(4);
  expect(session.getSnapshot().document.frames["2"]![0]!.points[0]!.x).toBe(0.1);
  expect(session.getSnapshot().history.map((revision) => revision.revision)).toEqual([
    0, 1, 2, 3, 4,
  ]);
  session.edit((document) => {
    document.classes[0]!.name = "Truck";
    document.frames["2"]![0]!.points[0]!.x = 5.5;
  });
  session.submit();
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().saved.revision).toBe(5);
});

it("blocks dependent writes on failure, retries the same snapshot, and preserves edits on conflicts", async () => {
  const service = new MockAnnotationService(10);
  const session = new AnnotationSession(service, "scope");
  await session.load();
  session.edit(addObject);
  service.failNextWrite = true;
  session.submit();
  session.edit((document) => {
    document.classes[0]!.name = "Newer draft";
  });
  session.submit();
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().jobs.map((job) => job.status)).toEqual(["failed", "queued"]);
  expect(session.getSnapshot().document.classes[0]!.name).toBe("Newer draft");
  session.retry();
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  expect(session.getSnapshot().saved.revision).toBe(2);
  const other = service.commit({
    scope: "scope",
    expectedRevision: 2,
    requestId: "external",
    document: emptyDocument(),
    message: "Other editor",
  });
  await jest.runAllTimersAsync();
  await other;
  session.edit((document) => {
    document.classes[0]!.name = "Keep me";
  });
  session.submit();
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().error).toContain("Revision conflict");
  expect(session.getSnapshot().document.classes[0]!.name).toBe("Keep me");
  session.retry();
  await jest.runAllTimersAsync();
  expect(session.getSnapshot().saved.revision).toBe(2);
  await session.discard();
  expect(session.getSnapshot().saved.revision).toBe(3);
  expect(session.getSnapshot().document.classes).toEqual([]);
});

it("rejects stale rollback writes rather than overwriting another editor", async () => {
  const service = new MockAnnotationService(0);
  const commit = service.commit({
    scope: "scope",
    expectedRevision: 0,
    requestId: "first",
    document: emptyDocument(),
    message: "First",
  });
  await jest.runAllTimersAsync();
  await commit;
  const restore = service.rollback({
    scope: "scope",
    expectedRevision: 0,
    requestId: "stale",
    targetRevision: 0,
  });
  const rejected = restore.catch((error: unknown) => error);
  await jest.runAllTimersAsync();
  expect(await rejected).toBeInstanceOf(AnnotationConflict);
});
