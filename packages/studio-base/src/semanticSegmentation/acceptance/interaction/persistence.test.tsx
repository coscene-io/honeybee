/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { deferred, polygon, setup, triangle } from "./fixtures";
import { SubmissionControls, WorkflowControls } from "../../components/WorkflowControls";
import { cloneSegmentation, frameInstanceKey } from "../../service";

it("SEG-SAVE-001/014 stages edits without writes and keeps newer B dirty when A is acknowledged", async () => {
  const { service, store } = await setup();
  const gate = deferred();
  const original = service.submit.bind(service);
  const submit = jest.spyOn(service, "submit").mockImplementation(async (request) => {
    await gate.promise;
    return await original(request);
  });
  render(
    <>
      <SubmissionControls store={store} />
      <WorkflowControls store={store} />
    </>,
  );
  act(() => {
    store.getState().setPolygonPoints(polygon(store).id, triangle);
  });
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(polygon(store).points).toEqual(triangle);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /提交 1/ }));
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(1);
  });
  let later!: string;
  act(() => {
    later = store.getState().addPolygon("instance-2", triangle);
  });
  await act(async () => {
    gate.resolve();
    await store.getState().waitForSubmissions();
  });
  expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(
    store
      .getState()
      .document!.annotations[
        frameInstanceKey("frame-0", "instance-2")
      ]!.polygons.some((item) => item.id === later),
  ).toBe(true);
  expect(screen.getByRole("button", { name: /提交 1/ }).className).toContain("seg-dirty");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await service.loadFrameWindow("video-1", 0, 1)).annotations[
      frameInstanceKey("frame-0", "instance-2")
    ]!.polygons.some((item) => item.id === later),
  ).toBe(false);
  store.getState().dispose();
});

it("SEG-SAVE-015 retains failed snapshot A and excludes later B from its explicit retry payload", async () => {
  const { store, service } = await setup();
  const submit = jest.spyOn(service, "submit");
  store.getState().setPolygonPoints(polygon(store).id, triangle);
  service.setControls({ failNext: true });
  const batchId = store.getState().submit()!;
  await store.getState().waitForSubmissions();
  const failed = cloneSegmentation(store.getState().submissionQueue[0]!);
  expect(failed.status).toBe("failed");
  const later = store.getState().addPolygon("instance-2", triangle);
  render(<WorkflowControls store={store} />);
  expect(screen.getByRole("alert").textContent).toMatch(/fail/i);
  fireEvent.click(screen.getByRole("button", { name: "重试提交" }));
  await act(async () => {
    await store.getState().waitForSubmissions();
  });
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
  expect(store.getState().submissionQueue[0]).toMatchObject({
    id: batchId,
    status: "succeeded",
    operations: failed.operations,
  });
  expect(JSON.stringify(submit.mock.calls[1]![0])).not.toContain(later);
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});

it.each([
  { frameId: "frame-2", instanceId: "instance-2" },
  { frameId: "frame-3", instanceId: "instance-1" },
])(
  "SEG-SAVE-018 accepts B at $frameId/$instanceId after external A at I frame 2",
  async ({ frameId, instanceId }) => {
    const { service, store } = await setup();
    store.getState().setCurrentFrame(frameId);
    store.getState().setPolygonPoints(polygon(store, instanceId, frameId).id, triangle);
    service.simulateExternalEdit("frame-2", "instance-1");
    store.getState().submit();
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
    expect(store.getState().submissionQueue[0]!.conflicts ?? []).toHaveLength(0);
    expect(
      (await service.loadFrameWindow("video-1", 0, 1)).annotations[
        frameInstanceKey(frameId, instanceId)
      ]!.polygons[0]!.points,
    ).toEqual(triangle);
    store.getState().dispose();
  },
);

it("SEG-SAVE-021 conflict restores authoritative data and makes no automatic force write", async () => {
  const { service, store } = await setup();
  const submit = jest.spyOn(service, "submit");
  const added = store.getState().addPolygon("instance-1", triangle);
  service.simulateExternalEdit("frame-0", "instance-1");
  const authoritative = await service.loadFrameWindow("video-1", 0, 1);
  store.getState().submit();
  await store.getState().waitForSubmissions();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(store.getState().submissionQueue[0]!.status).toBe("conflict");
  expect(store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]).toEqual(
    authoritative.annotations[frameInstanceKey("frame-0", "instance-1")],
  );
  expect(polygon(store).id).not.toBe(added);
  expect(await service.loadFrameWindow("video-1", 0, 1)).toEqual(authoritative);
  expect(submit).toHaveBeenCalledTimes(1);
  store.getState().dispose();
});

it("SEG-SAVE-022 writes frames 0/3 only and reloads unchanged frame 2 under the acknowledged revision", async () => {
  const { store, service } = await setup();
  const unchanged = polygon(store, "instance-1", "frame-2");
  for (const frame of ["frame-0", "frame-3"]) {
    store.getState().setCurrentFrame(frame);
    store.getState().setPolygonPoints(polygon(store, "instance-1", frame).id, triangle);
  }
  store.getState().submit();
  await store.getState().waitForSubmissions();
  const revisionId = store.getState().submissionQueue[0]!.revisionId!;
  expect(revisionId).toBe(store.getState().revisions[0]!.id);
  const acknowledged = await service.loadRevision(revisionId);
  const loaded = await service.loadFrameWindow("video-1", 0, 1);
  for (const frame of ["frame-0", "frame-3", "frame-2"]) {
    const key = frameInstanceKey(frame, "instance-1");
    expect(loaded.annotations[key]).toEqual(acknowledged.annotations[key]);
    expect(loaded.annotations[key]!.polygons[0]!.points).toEqual(
      frame === "frame-2" ? unchanged.points : triangle,
    );
    expect(loaded.versions[key]).toBe(frame === "frame-2" ? 1 : 2);
  }
  store.getState().dispose();
});

it("SEG-VER-004/005/008 cancels restore without intent and appends R3 while retaining R1/R2; local reset is local-only", async () => {
  const { store, service } = await setup();
  store.getState().renameClass("class-1", "R1 name");
  store.getState().submit("R1");
  await store.getState().waitForSubmissions();
  const r1 = store.getState().revisions[0]!.id;
  store.getState().renameClass("class-1", "R2 name");
  store.getState().submit("R2");
  await store.getState().waitForSubmissions();
  const r2 = store.getState().revisions[0]!.id;
  const rollback = jest.spyOn(service, "rollbackRevision");
  const submit = jest.spyOn(service, "submit");
  render(
    <>
      <SubmissionControls store={store} />
      <WorkflowControls store={store} />
    </>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "回退到此版本" })[1]!);
  const head = store.getState().revisions;
  const current = store.getState().document;
  const staged = store.getState().stagedOperations;
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(store.getState().document).toEqual(current);
  expect(store.getState().revisions).toEqual(head);
  expect(store.getState().stagedOperations).toEqual(staged);
  expect(rollback).not.toHaveBeenCalled();
  act(() => {
    store.getState().renameClass("class-1", "Local-only name");
  });
  fireEvent.click(screen.getByRole("button", { name: "清除暂存" }));
  expect(screen.getByRole("dialog").textContent).toContain("不会创建新版本");
  fireEvent.click(screen.getByRole("button", { name: "仅清除未提交修改" }));
  expect(store.getState().document).toEqual(current);
  expect(store.getState().revisions).toEqual(head);
  expect(submit).not.toHaveBeenCalled();
  expect(rollback).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "回退到此版本" })[1]!);
  expect(screen.getByRole("dialog").textContent).toContain("追加一条回退记录");
  fireEvent.click(screen.getByRole("button", { name: "确认回退" }));
  await waitFor(() => {
    expect(store.getState().revisions).toHaveLength(head.length + 1);
  });
  expect(rollback).toHaveBeenCalledWith(r1, r2);
  expect(store.getState().document!.classes[0]!.name).toBe("R1 name");
  const ids = store.getState().revisions.map((revision) => revision.id);
  expect(ids.slice(1, 3)).toEqual([r2, r1]);
  expect(ids[0]).not.toBe(r1);
  expect(ids[0]).not.toBe(r2);
  expect((await service.loadRevision(r1)).classes[0]!.name).toBe("R1 name");
  expect((await service.loadRevision(r2)).classes[0]!.name).toBe("R2 name");
  store.getState().dispose();
});
