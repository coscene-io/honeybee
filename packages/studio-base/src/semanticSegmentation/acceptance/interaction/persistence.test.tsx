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
