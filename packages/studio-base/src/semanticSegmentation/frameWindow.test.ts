// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService } from "./mockService";
import { createSegmentationRuntime } from "./runtime";
import { createSemanticSegmentationStore } from "./store";
import type { FrameWindow } from "./types";

async function settleRead(store: ReturnType<typeof createSemanticSegmentationStore>) {
  for (let index = 0; index < 50 && store.getState().loading; index++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(store.getState().loading).toBe(false);
}

it("retries the exact failed range without resetting queued submissions or drafts", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  const originalSubmit = service.submit.bind(service);
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  service.submit = async (request) => {
    await pending;
    return await originalSubmit(request);
  };
  store.getState().addClass("queued before seek");
  store.getState().submit("keep this queue");
  const queued = store.getState().submissionQueue[0]!.id;
  const draft = store.getState().addClass("draft after queue");
  const read = jest.spyOn(service, "loadFrameWindow");
  service.setControls({ failNext: true });
  store.getState().setCurrentFrame("frame-55");
  await settleRead(store);
  expect(store.getState().isFrameReady("frame-55")).toBe(false);
  expect(store.getState().frameWindowError).toMatchObject({
    videoId: "video-1",
    startSec: 10,
    endSec: 20,
  });
  await store.getState().retryCurrentFrameWindow();
  expect(read.mock.calls.at(-1)?.slice(0, 3)).toEqual(["video-1", 10, 20]);
  expect(store.getState().isFrameReady("frame-55")).toBe(true);
  expect(store.getState().frameWindowError).toBeUndefined();
  expect(store.getState().submissionQueue[0]?.id).toBe(queued);
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().document?.classes.some((item) => item.id === draft)).toBe(true);
  store.setState({ error: "Unrelated GPU status failure" });
  expect(store.getState().isFrameReady("frame-55")).toBe(true);
  acknowledge();
  await store.getState().waitForSubmissions();
  store.getState().dispose();
});

it("ignores a retry response after a newer frame-window generation has won", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  service.setControls({ failNext: true });
  store.getState().setCurrentFrame("frame-55");
  await settleRead(store);
  const originalRead = service.loadFrameWindow.bind(service);
  let finishOld!: (value: FrameWindow) => void;
  service.loadFrameWindow = async (videoId, startSec, endSec, signal) =>
    startSec === 10
      ? await new Promise<FrameWindow>((resolve) => {
          finishOld = resolve;
        })
      : await originalRead(videoId, startSec, endSec, signal);
  const retry = store.getState().retryCurrentFrameWindow();
  store.getState().setCurrentFrame("frame-105");
  await settleRead(store);
  finishOld(await originalRead("video-1", 10, 20));
  await retry;
  expect(store.getState().currentFrameId).toBe("frame-105");
  expect(store.getState().isFrameReady("frame-105")).toBe(true);
  expect(store.getState().isFrameReady("frame-55")).toBe(false);
  expect(store.getState().frameWindowError).toBeUndefined();
  store.getState().dispose();
});

it("recovers a failed first geometry read in a runtime without reinitializing its document", async () => {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({ delayMs: 0 });
  const originalRead = runtime.service.loadFrameWindow.bind(runtime.service);
  runtime.service.loadFrameWindow = jest
    .fn()
    .mockRejectedValueOnce(new Error("first geometry read failed"))
    .mockImplementation(originalRead);
  const loadDocument = jest.spyOn(runtime.service, "loadDocument");
  await runtime.initialize();
  expect(runtime.store.getState().document).toBeDefined();
  expect(runtime.store.getState().isFrameReady("frame-0")).toBe(false);
  const draft = runtime.store.getState().addClass("retain failed-window draft");
  await runtime.store.getState().retryCurrentFrameWindow();
  expect(loadDocument).toHaveBeenCalledTimes(1);
  expect(runtime.store.getState().isFrameReady("frame-0")).toBe(true);
  expect(runtime.store.getState().document?.classes.some((item) => item.id === draft)).toBe(true);
  runtime.dispose();
});
