/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { fromNanoSec, toNanoSec, type Time } from "@foxglove/rostime";

import type { SegmentationImage } from "../imageSource";
import { type SegmentationRuntime } from "../runtime";
import { frameInstanceKey } from "../service";
import { SegmentationImageEntry } from "./SegmentationImageEntry";
import { SegmentationWorkspace } from "./SegmentationWorkspace";
import { enterAnnotation, recordEntryActions } from "../testing/entryActions";
import { setMockControls } from "../testing/mockService";
import { focusedSurface } from "../testing/session";
import { render, testHost, createTestBridge, useSegmentationTestHost } from "../testing/host";

useSegmentationTestHost();

const pipeline = {
  playerState: {
    playerId: "native-presentation",
    name: "Camera",
    urlState: { sourceId: "remote-mp4", parameters: { url: "native-presentation.mp4" } },
    progress: {},
    activeData: {
      startTime: fromNanoSec(0n),
      endTime: fromNanoSec(1_000_000_000n),
      currentTime: fromNanoSec(400_000_000n),
      lastSeekTime: 0,
      messages: [],
    },
  },
  pausePlayback: jest.fn(),
  seekPlayback: jest.fn((time) => {
    pipeline.playerState.activeData.currentTime = time;
    // Deliberately unchanged Date.now-style seek generation: local request tokens must fence it.
  }),
};
const getPipeline = () => pipeline;
let mockUserId = "native-test-user";
let mockWithoutCancel = false;
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (state: typeof pipeline) => unknown) => selector(pipeline),
  useMessagePipelineGetter: () => getPipeline,
}));
jest.mock("@foxglove/studio-base/components/PanelToolbar", () => ({
  PANEL_TOOLBAR_MIN_HEIGHT: 30,
}));
jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (store: { user?: { userId: string } }) => unknown) =>
    selector({ user: mockUserId ? { userId: mockUserId } : undefined }),
}));
// The fixture source counts as a cloud record; sessions use the in-memory mock service in place of the live one.
jest.mock("@foxglove/studio-base/util/coscene/annotation", () => ({
  isAnnotationRecordName: () => true,
  createLiveSemanticSegmentationService: ({ document }: { document: unknown }) => {
    const service = jest
      .requireActual<
        typeof import("@foxglove/studio-base/semanticSegmentation/testing/mockService")
      >("@foxglove/studio-base/semanticSegmentation/testing/mockService")
      .createMockSemanticSegmentationService({
        document: document as never,
        controls: { delayMs: 500, streamDelayMs: 350 },
      });
    if (mockWithoutCancel) {
      // The runtime takes the service's optional methods when it is created.
      service.cancelPropagation = undefined;
    }
    return service;
  },
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: { record: { value?: undefined } }) => unknown) =>
    selector({ record: { value: undefined } }),
}));
jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: () => ({ sidebarActions: { left: { selectItem: jest.fn() } } }),
}));

const realSetTimeout = setTimeout;
const rafs = new Map<number, FrameRequestCallback>();
let nextRaf = 0;
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; ++i) {
      await Promise.resolve();
    }
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 0);
    });
  });
}
let sequence = 0;
async function fixture(options: { withoutCancel?: boolean } = {}) {
  mockWithoutCancel = options.withoutCancel === true;
  const containerRef = createRef<HTMLDivElement>();
  pipeline.playerState.urlState.parameters.url = `native-presentation-${++sequence}.mp4`;
  // Nine recorded frames, 100 ms apart; message times identify each frame.
  pipeline.playerState.activeData.messages = Array.from({ length: 9 }, (_, index) => {
    const time = fromNanoSec(BigInt(index) * 100_000_000n);
    return { topic: "/camera", receiveTime: time, message: { timestamp: time } };
  }) as never;
  let image: SegmentationImage = {
    imageUrl: "data:image/png;base64,seed5",
    topic: "/camera",
    timestamp: fromNanoSec(400_000_000n),
    receiveTime: fromNanoSec(400_000_000n),
    decodedIdentity: {},
    nativeView: {
      width: 960,
      height: 540,
      imageWidth: 960,
      imageHeight: 540,
      matrix: [1, 0, 0, 1, 0, 0],
    },
  };
  const bridge = createTestBridge();
  const view = (mode: "workspace" | "entry" = "workspace") => (
    <div ref={containerRef}>
      <canvas width={8} height={4} />
      <SegmentationImageEntry
        onActionsChange={recordEntryActions}
        containerRef={containerRef}
        bridge={bridge}
        topic="/camera"
        panelId="native-panel"
        onMaximize={() => {}}
      />
      {mode === "workspace" && <SegmentationWorkspace panelId="native-panel" />}
    </div>
  );
  const result = render(view());
  const canvas = containerRef.current!.querySelector("canvas")!;
  bridge.publish({ image: () => image });
  act(() => {
    enterAnnotation();
  });
  await waitFor(
    () => {
      expect(testHost().session.getState().open).toBe(true);
    },
    { timeout: 3000 },
  );
  const runtime = testHost().session.getState().runtime!;
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0, cancelDelayMs: 400 });
  let instanceId = "";
  act(() => {
    const classId = runtime.store.getState().addClass("tracked");
    instanceId = runtime.store.getState().addInstance(classId, "target");
    runtime.store.getState().addPolygon(instanceId, [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ]);
  });
  const fromFrameId = runtime.store.getState().currentFrameId!;
  const frames = runtime.store.getState().document!.frames;
  const seed =
    runtime.store.getState().document!.annotations[frameInstanceKey(fromFrameId, instanceId)]!;
  runtime.service.propagate = async function* (request) {
    for (const index of [5, 6, 7]) {
      yield { ...seed, frameId: frames[index]!.id, context: request.context };
    }
  };
  const start = async () => {
    await runtime.store
      .getState()
      .startPropagation({ instanceId, fromFrameId, endTimeNs: "1700000000600000000" });
  };
  return {
    ...result,
    runtime,
    frames,
    view,
    start,
    decode(index: number, changes?: Partial<SegmentationImage>) {
      image = {
        ...image,
        imageUrl: `data:image/png;base64,frame${index + 1}`,
        timestamp: fromNanoSec(BigInt(index) * 100_000_000n),
        receiveTime: fromNanoSec(BigInt(index) * 100_000_000n),
        decodedIdentity: {},
        ...changes,
      };
      act(() => {
        canvas.dispatchEvent(new Event("segmentation-frame", { bubbles: true }));
      });
    },
    event() {
      act(() => {
        canvas.dispatchEvent(new Event("segmentation-frame", { bubbles: true }));
      });
    },
  };
}

beforeEach(() => {
  mockUserId = "native-test-user";
  pipeline.playerState.activeData.currentTime = fromNanoSec(400_000_000n);
  pipeline.playerState.activeData.lastSeekTime = 0;
  testHost().session.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    presentation: undefined,
    sourceReady: false,
  });
  rafs.clear();
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    rafs.set(++nextRaf, callback);
    return nextRaf;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    rafs.delete(id);
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: jest.fn(),
  });
  pipeline.seekPlayback.mockClear();
  pipeline.pausePlayback.mockClear();
});
afterEach(() => {
  const runtime = testHost().session.getState().runtime;
  cleanup();
  runtime?.dispose();
});

/** Log times of the frames whose propagation results were staged. */
function resultLogTimes(runtime: SegmentationRuntime): Set<string> {
  const document = runtime.store.getState().document!;
  return new Set(
    runtime.store
      .getState()
      .stagedOperations.flatMap((operation) =>
        Object.values(operation.patch.annotations ?? {}).flatMap((annotation) =>
          annotation ? [annotation.frameId] : [],
        ),
      )
      .map((frameId) => document.frames.find((frame) => frame.id === frameId)!.logTimeNs),
  );
}

function seekedLogTimes(): string[] {
  return (jest.mocked(pipeline.seekPlayback).mock.calls as [Time][]).map(([time]) =>
    toNanoSec(time).toString(),
  );
}

it("streams propagation results, lets the player follow them and never replaces native pixels", async () => {
  const f = await fixture();
  const shown = focusedSurface(testHost().session)?.decodedFrame?.frameId;
  await act(async () => {
    await f.start();
  });
  expect(f.runtime.store.getState().propagation.status).toBe("completed");
  // The player follows the results (throttled seeks), never pauses, and only to result frames.
  const results = resultLogTimes(f.runtime);
  expect(seekedLogTimes().length).toBeGreaterThan(0);
  expect(seekedLogTimes().every((time) => results.has(time))).toBe(true);
  expect(pipeline.pausePlayback).not.toHaveBeenCalled();
  expect(focusedSurface(testHost().session)?.decodedFrame?.frameId).toBe(shown);
  expect(f.container.querySelector("svg image")).toBeNull();
  expect(
    f.container
      .querySelector('[data-testid="segmentation-native-overlay"]')
      ?.getAttribute("data-log-time-ns"),
  ).toBe("400000000");
  expect(f.runtime.store.getState().stagedOperations.length).toBeGreaterThan(3);
});

it("keeps the seed immutable while native playback advances during propagation", async () => {
  const f = await fixture();
  const original = f.runtime.service.propagate.bind(f.runtime.service);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let capturedSeed: string | undefined;
  f.runtime.service.propagate = async function* (request, signal) {
    capturedSeed = request.fromFrameId;
    await gate;
    yield* original(request, signal);
  };
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  pipeline.playerState.activeData.currentTime = fromNanoSec(650_000_000n);
  f.decode(6);
  expect(capturedSeed).toBe(f.frames[4]!.id);
  expect(focusedSurface(testHost().session)?.decodedFrame?.frameId).toBe(f.frames[6]!.id);
  await act(async () => {
    release();
    await running;
  });
  // Following the results seeks only to result frames; the seed stays the frame it started on.
  const results = resultLogTimes(f.runtime);
  expect(seekedLogTimes().every((time) => results.has(time))).toBe(true);
  expect(capturedSeed).toBe(f.frames[4]!.id);
});

it("STOP rejects late results and waits for iterator termination without a native presentation", async () => {
  const f = await fixture({ withoutCancel: true });
  const original = f.runtime.service.propagate.bind(f.runtime.service);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.runtime.service.propagate = async function* (request, signal) {
    const iterator = original(request, signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done !== true) {
      yield first.value;
    }
    await gate;
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      yield next.value;
    }
  };
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  const accepted = f.runtime.store.getState().stagedOperations;
  act(() => {
    f.runtime.store.getState().stopPropagation();
  });
  expect(f.runtime.store.getState().propagation.status).toBe("stopping");
  expect(() => f.runtime.store.getState().addClass("locked")).toThrow("Stop propagation");
  await act(async () => {
    finish();
    await running;
  });
  expect(f.runtime.store.getState().propagation.status).toBe("cancelled");
  expect(f.runtime.store.getState().stagedOperations).toBe(accepted);
  // The player follows propagation only to frames accepted before STOP (or stays on the seed),
  // never to a late result.
  const allowed = resultLogTimes(f.runtime);
  allowed.add(f.frames[4]!.logTimeNs);
  expect(seekedLogTimes().every((time) => allowed.has(time))).toBe(true);
});

it("accepts a fresh decode before React observes the native seek and hides stale geometry", async () => {
  const f = await fixture();
  pipeline.playerState.activeData.currentTime = fromNanoSec(550_000_000n);
  pipeline.playerState.activeData.lastSeekTime = 123;
  f.decode(5);
  f.rerender(f.view());
  expect(testHost().session.getState().sourceReady).toBe(true);
  expect(focusedSurface(testHost().session)?.decodedFrame?.frameId).toBe(f.frames[5]!.id);
  f.decode(4);
  expect(testHost().session.getState().sourceReady).toBe(false);
  expect(f.container.querySelector('[data-testid="instance-union-fill"]')).toBeNull();
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
});

it("fences native identity after the user changes", async () => {
  const f = await fixture();
  mockUserId = "other";
  f.rerender(f.view());
  await flush();
  expect(testHost().session.getState().open).toBe(false);
  expect(f.container.querySelector('[data-testid="segmentation-native-overlay"]')).toBeNull();
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
});

it("keeps handles a fixed screen size when the Image panel zooms the native view", async () => {
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value(this: SVGElement) {
      const scale = Number(this.getAttribute("transform")?.match(/matrix\(([-\d.e]+)/)?.[1] ?? 1);
      return { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
    },
  });
  const f = await fixture();
  act(() => {
    const store = f.runtime.store.getState();
    store.setFocus({ type: "instance", id: Object.values(store.document!.instances)[0]!.id });
    store.setEditing(true);
  });
  await flush();
  const radius = () =>
    Number(document.querySelector('[data-testid="vertex-handle-visible"]')?.getAttribute("r"));
  expect(radius()).toBe(4.5);
  f.decode(4, {
    nativeView: {
      width: 960,
      height: 540,
      imageWidth: 960,
      imageHeight: 540,
      matrix: [4, 0, 0, 4, 0, 0],
    },
  });
  await flush();
  expect(radius()).toBe(4.5 / 4);
});
