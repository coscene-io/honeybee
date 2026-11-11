// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { createMockSemanticSegmentationService } from "./mockService";
import { frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import type {
  PropagationCancellation,
  PropagationContext,
  SemanticSegmentationStore,
} from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(
  store: ReturnType<typeof createSemanticSegmentationStore>,
  predicate: (state: SemanticSegmentationStore) => boolean,
): Promise<void> {
  if (predicate(store.getState())) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => {
    const detach = store.subscribe((state) => {
      if (predicate(state)) {
        detach();
        resolve();
      }
    });
  });
}
async function fixture() {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, cancelDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  const gate = deferred<void>();
  const accepted = deferred<void>();
  const source = store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!;
  service.propagate = async function* (request) {
    yield { ...source, frameId: "frame-1", context: request.context };
    accepted.resolve();
    await gate.promise;
    yield { ...source, frameId: "frame-2", context: request.context };
  };
  const running = store.getState().startPropagation({
    instanceId: "instance-1",
    fromFrameId: "frame-0",
    frameCount: 2,
  });
  await accepted.promise;
  return { service, store, gate, running };
}

it("SEG-ONLINE-011 sends one cancel, rejects late output immediately, and waits for the matching acknowledgement before unlocking", async () => {
  const { service, store, gate, running } = await fixture();
  const acknowledgement = deferred<PropagationCancellation>();
  let context: PropagationContext | undefined;
  const cancel = jest.fn(async (request: PropagationContext) => {
    context = request;
    return await acknowledgement.promise;
  });
  service.cancelPropagation = cancel;
  store.getState().stopPropagation();
  store.getState().stopPropagation();
  store.getState().stopPropagation();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(store.getState().propagation).toMatchObject({
    status: "stopping",
    cancellationPending: true,
    processedFrames: 1,
  });
  expect(() => store.getState().addClass("Locked until ack")).toThrow("Stop propagation");
  expect(() => {
    store.getState().setCurrentFrame("frame-3");
  }).toThrow("Stop propagation");
  gate.resolve();
  await running;
  expect(store.getState().propagation.status).toBe("stopping");
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().currentFrameId).toBe("frame-1");
  const stopped = until(store, (state) => state.propagation.status === "cancelled");
  acknowledgement.resolve({ requestId: context!.requestId, status: "cancelled" });
  await stopped;
  expect(() => store.getState().addClass("Manual edit after ack")).not.toThrow();
  store.getState().stopPropagation();
  expect(cancel).toHaveBeenCalledTimes(1);
  store.getState().dispose();
});

it("keeps a failed acknowledgement stopping/locked and permits one explicit retry", async () => {
  const { service, store, gate, running } = await fixture();
  service.setControls({ failCancelNext: true });
  const cancel = jest.spyOn(service, "cancelPropagation");
  store.getState().stopPropagation();
  await until(
    store,
    (state) => state.propagation.status === "stopping" && state.propagation.error != undefined,
  );
  expect(store.getState().propagation.cancellationPending).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(() => store.getState().addClass("Still locked")).toThrow("Stop propagation");
  const stopped = until(store, (state) => state.propagation.status === "cancelled");
  store.getState().stopPropagation();
  store.getState().stopPropagation();
  await stopped;
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(cancel.mock.calls[0]![0].requestId).toBe(cancel.mock.calls[1]![0].requestId);
  expect(store.getState().propagation.error).toBeUndefined();
  gate.resolve();
  await running;
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});

it("does not unlock for another job's cancellation acknowledgement", async () => {
  const { service, store, gate, running } = await fixture();
  service.cancelPropagation = async () => ({ requestId: "foreign-job", status: "cancelled" });
  store.getState().stopPropagation();
  await until(store, (state) => state.propagation.error?.includes("another request") === true);
  expect(store.getState().propagation.status).toBe("stopping");
  service.cancelPropagation = async (context) => ({
    requestId: context.requestId,
    status: "cancelled",
  });
  const stopped = until(store, (state) => state.propagation.status === "cancelled");
  store.getState().stopPropagation();
  await stopped;
  gate.resolve();
  await running;
  store.getState().dispose();
});

it("uses actual iterator termination as acknowledgement for a legacy adapter without the cancel seam", async () => {
  const { service, store, gate, running } = await fixture();
  service.cancelPropagation = undefined;
  store.getState().stopPropagation();
  store.getState().stopPropagation();
  expect(store.getState().propagation.status).toBe("stopping");
  expect(() => store.getState().addClass("Not yet acknowledged")).toThrow("Stop propagation");
  gate.resolve();
  await running;
  expect(store.getState().propagation.status).toBe("cancelled");
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(() => store.getState().addClass("Legacy terminal ack received")).not.toThrow();
  store.getState().dispose();
});

it("ignores an acknowledgement that arrives after disposal", async () => {
  const { service, store, gate, running } = await fixture();
  const acknowledgement = deferred<PropagationCancellation>();
  service.cancelPropagation = async () => await acknowledgement.promise;
  store.getState().stopPropagation();
  await Promise.resolve();
  store.getState().dispose();
  const before = store.getState();
  acknowledgement.resolve({ requestId: "old-job", status: "cancelled" });
  gate.resolve();
  await running;
  await Promise.resolve();
  expect(store.getState()).toBe(before);
});
