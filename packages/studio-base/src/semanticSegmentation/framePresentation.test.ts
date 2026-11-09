// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FRAME_PRESENTATION_TIMEOUT_MS } from "./framePresentation";
import { createMockSemanticSegmentationService } from "./mockService";
import { frameInstanceKey } from "./service";
import { createSemanticSegmentationStore } from "./store";
import type { FramePresentationRequest, PropagationCancellation } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const realSetTimeout = setTimeout;
async function flush() {
  for (let i = 0; i < 25; ++i) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => {
    realSetTimeout(resolve, 0);
  });
}
async function fixture(order = [1, 2, 3], direction: "forward" | "backward" = "forward") {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, cancelDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  const seed = store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!;
  if (direction === "backward") {
    store.getState().setCurrentFrame("frame-4");
    await flush();
    store.getState().addPolygon("instance-1", seed.polygons[0]!.points);
  }
  const pulls: number[] = [];
  service.propagate = async function* (request) {
    for (const frame of order) {
      pulls.push(frame);
      yield { ...seed, frameId: `frame-${frame}`, context: request.context };
    }
  };
  const waits: { request: FramePresentationRequest; gate: ReturnType<typeof deferred<void>> }[] =
    [];
  const detach = store.getState().registerFramePresenter(async (request) => {
    const gate = deferred<void>();
    waits.push({ request, gate });
    await gate.promise;
  });
  const start = async () => {
    await store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: direction === "backward" ? "frame-4" : "frame-0",
      direction,
      frameCount: 3,
    });
  };
  return { service, store, pulls, waits, detach, start };
}

it.each([
  { order: [1, 2, 3], expected: [1, 2, 3], reverse: false },
  { order: [3, 2, 1, 1], expected: [1, 2, 3], reverse: false },
  { order: [1, 3, 2, 2], expected: [1, 2, 3], reverse: false },
  { order: [3, 1], expected: [1, 3], reverse: false },
])(
  "serializes contiguous/terminal display independently of arrival order: $order",
  async ({ order, expected, reverse }) => {
    const f = await fixture(order, reverse ? "backward" : "forward");
    const running = f.start();
    for (const [index, frame] of expected.entries()) {
      await flush();
      const wait = f.waits[index]!;
      expect(wait.request.frame.id).toBe(`frame-${frame}`);
      expect(f.waits).toHaveLength(index + 1);
      expect(f.store.getState().currentFrameId).toBe(`frame-${frame}`);
      expect(f.store.getState().propagation.status).toBe("running");
      expect(f.store.getState().stagedOperations.length).toBeGreaterThan(0);
      wait.gate.resolve();
    }
    await running;
    expect(f.store.getState().propagation.status).toBe("completed");
    expect(f.store.getState().propagation.processedFrames).toBe(new Set(order).size);
    expect(f.waits.map((wait) => wait.request.frame.id)).toEqual(expected.map((n) => `frame-${n}`));
    f.store.getState().dispose();
  },
);

it("STOP aborts a hung display immediately, retains its accepted draft and waits for backend terminal acknowledgement", async () => {
  const f = await fixture();
  const ack = deferred<PropagationCancellation>();
  f.service.cancelPropagation = async () => await ack.promise;
  const running = f.start();
  await flush();
  const { request, gate } = f.waits[0]!;
  f.store.getState().stopPropagation();
  expect(request.signal.aborted).toBe(true);
  await running;
  expect(f.pulls).toEqual([1]);
  expect(f.store.getState().propagation.status).toBe("stopping");
  expect(f.store.getState().stagedOperations).toHaveLength(1);
  gate.resolve();
  await flush();
  expect(f.store.getState().propagation.status).toBe("stopping");
  ack.resolve({ requestId: request.context.requestId, status: "cancelled" });
  await flush();
  expect(f.store.getState().propagation.status).toBe("cancelled");
  f.store.getState().dispose();
});

it("unregister between paced results cancels the original job rather than falling back to cursor-only completion", async () => {
  const f = await fixture();
  const between = deferred<void>();
  f.service.propagate = async function* (request) {
    const seed =
      f.store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!;
    yield { ...seed, frameId: "frame-1", context: request.context };
    await between.promise;
    yield { ...seed, frameId: "frame-2", context: request.context };
  };
  const running = f.start();
  await flush();
  f.waits[0]!.gate.resolve();
  await flush();
  expect(f.waits[0]!.request.signal.aborted).toBe(true);
  f.detach();
  between.resolve();
  await running;
  await flush();
  expect(f.store.getState().propagation.status).toBe("cancelled");
  expect(f.store.getState().stagedOperations).toHaveLength(1);
  expect(f.waits).toHaveLength(1);
  f.store.getState().dispose();
});

it("missing presentation fails within the safety deadline and releases listeners without committing drafts", async () => {
  const f = await fixture();
  jest.useFakeTimers();
  try {
    const running = f.start();
    await flush();
    expect(f.waits).toHaveLength(1);
    jest.advanceTimersByTime(FRAME_PRESENTATION_TIMEOUT_MS);
    await running;
    expect(f.waits[0]!.request.signal.aborted).toBe(true);
    expect(f.store.getState().propagation.status).toBe("failed");
    expect(f.store.getState().error).toContain("presentation timed out");
    expect(f.store.getState().stagedOperations).toHaveLength(1);
    expect(f.store.getState().submissionQueue).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    f.store.getState().dispose();
    jest.useRealTimers();
  }
});

it.each(["dispose", "readonly", "record", "revision", "video"])(
  "invalidates a pending display on %s without overwriting new context",
  async (change) => {
    const f = await fixture();
    const running = f.start();
    await flush();
    if (change === "dispose") {
      f.store.getState().dispose();
    } else if (change === "readonly") {
      f.store.setState({ readonly: true });
    } else if (change === "revision") {
      f.store.setState({
        revisions: f.store
          .getState()
          .revisions.map((revision, index) =>
            index === 0 ? { ...revision, id: "new-head" } : revision,
          ),
      });
    } else {
      const document = f.store.getState().document!;
      f.store.setState({
        document:
          change === "video"
            ? {
                ...document,
                frames: document.frames.map((frame) => ({ ...frame, videoId: "other-video" })),
              }
            : { ...document, record: { ...document.record, id: "other-record" } },
      });
    }
    const after = f.store.getState();
    expect(f.waits[0]!.request.signal.aborted).toBe(true);
    f.waits[0]!.gate.resolve();
    await running;
    await flush();
    expect(f.store.getState().propagation.status).not.toBe("completed");
    expect(f.store.getState().document).toBe(after.document);
    f.store.getState().dispose();
  },
);

it("a presenter abort preserves legacy terminal-iterator acknowledgement when no cancel adapter exists", async () => {
  const f = await fixture();
  f.service.cancelPropagation = undefined;
  const running = f.start();
  await flush();
  f.store.getState().stopPropagation();
  expect(f.store.getState().propagation.status).toBe("stopping");
  await running;
  expect(f.store.getState().propagation.status).toBe("cancelled");
  expect(f.store.getState().stagedOperations).toHaveLength(1);
  expect(f.pulls).toEqual([1]);
  f.store.getState().dispose();
});
