/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { waitFor } from "@testing-library/react";

import { deferred, polygon, setup, triangle } from "./fixtures";
import { cloneSegmentation } from "../../service";

it("SEG-ONLINE-009/013/SEG-SAVE-002 restart uses corrected stopped-frame seed and fresh job without durable writes", async () => {
  const { store, service } = await setup();
  const entered = deferred();
  const release = deferred();
  const requests: Parameters<typeof service.propagate>[0][] = [];
  service.propagate = async function* (request) {
    requests.push(cloneSegmentation(request));
    const frameId = requests.length === 1 ? "frame-1" : "frame-2";
    yield {
      frameId,
      instanceId: "instance-1",
      version: 1,
      polygons: [
        { id: `result-${frameId}`, points: cloneSegmentation(request.seedPolygons![0]!.points) },
      ],
      context: request.context,
    };
    if (requests.length === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  const write = jest.spyOn(service, "submit");
  const running = store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-0",
    frameCount: 2,
  });
  await entered.promise;
  expect(store.getState().currentFrameId).toBe("frame-1");
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().stopPropagation();
  await waitFor(() => {
    expect(store.getState().propagation.status).toBe("cancelled");
  });
  store.getState().setPolygonPoints("result-frame-1", triangle);
  const corrected = cloneSegmentation(polygon(store, "instance-1", "frame-1"));
  await store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-1",
    frameCount: 1,
  });
  expect(requests[1]!.seedPolygons).toEqual([corrected]);
  expect(requests[1]!.context!.requestId).not.toBe(requests[0]!.context!.requestId);
  expect(requests[1]!.context!.seedSnapshotId).not.toBe(requests[0]!.context!.seedSnapshotId);
  expect(polygon(store, "instance-1", "frame-2").points).toEqual(triangle);
  expect(store.getState().stagedOperations).toHaveLength(3);
  release.resolve();
  await running;
  expect(write).not.toHaveBeenCalled();
  store.getState().dispose();
});
