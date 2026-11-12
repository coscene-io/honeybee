/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { segmentationImageSources, type SegmentationImage } from "../imageSource";
import { segmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import { SegmentationImageEntry } from "./SegmentationImageEntry";
import { SegmentationWorkspace } from "./SegmentationWorkspace";

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
async function fixture() {
  const containerRef = createRef<HTMLDivElement>();
  const source = {
    sourceId: `native-presentation-${++sequence}.mp4`,
    topic: "/camera",
    frames: Array.from({ length: 9 }, (_, index) => ({
      timestampNs: BigInt(index) * 100_000_000n,
      durationNs: 100_000_000n,
    })),
  };
  pipeline.playerState.urlState.parameters.url = source.sourceId;
  let image: SegmentationImage = {
    imageUrl: "data:image/png;base64,seed5",
    topic: "/camera",
    timestamp: fromNanoSec(400_000_000n),
    receiveTime: fromNanoSec(400_000_000n),
    decodedIdentity: {},
    providerId: "decoder-a",
    source,
    nativeView: {
      width: 960,
      height: 540,
      imageWidth: 960,
      imageHeight: 540,
      matrix: [1, 0, 0, 1, 0, 0],
    },
  };
  const view = (mode: "workspace" | "entry" = "workspace") => (
    <div ref={containerRef}>
      <canvas width={8} height={4} />
      <SegmentationImageEntry
        containerRef={containerRef}
        topic="/camera"
        panelId="native-panel"
        onMaximize={() => {}}
      />
      {mode === "workspace" && <SegmentationWorkspace panelId="native-panel" />}
    </div>
  );
  const result = render(view());
  const canvas = containerRef.current!.querySelector("canvas")!;
  segmentationImageSources.set(canvas, () => image);
  fireEvent.click(screen.getByTitle("编辑空间标注"));
  await waitFor(
    () => {
      expect(segmentationSession.getState().open).toBe(true);
    },
    { timeout: 3000 },
  );
  const runtime = segmentationSession.getState().runtime!;
  runtime.service.setControls({ delayMs: 0, streamDelayMs: 0, cancelDelayMs: 400 });
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
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    imageUrl: undefined,
    decodedFrame: undefined,
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
  const runtime = segmentationSession.getState().runtime;
  cleanup();
  runtime?.dispose();
});

it("streams propagation results without changing native time or replacing native pixels", async () => {
  const f = await fixture();
  const shown = segmentationSession.getState().decodedFrame?.frameId;
  await act(async () => {
    await f.start();
  });
  expect(f.runtime.store.getState().propagation.status).toBe("completed");
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  expect(pipeline.pausePlayback).not.toHaveBeenCalled();
  expect(toNanoSec(pipeline.playerState.activeData.currentTime)).toBe(400_000_000n);
  expect(segmentationSession.getState().decodedFrame?.frameId).toBe(shown);
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
  expect(segmentationSession.getState().decodedFrame?.frameId).toBe(f.frames[6]!.id);
  await act(async () => {
    release();
    await running;
  });
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  expect(toNanoSec(pipeline.playerState.activeData.currentTime)).toBe(650_000_000n);
});

it("STOP rejects late results and waits for iterator termination without a native presentation", async () => {
  const f = await fixture();
  f.runtime.service.cancelPropagation = undefined;
  const original = f.runtime.service.propagate.bind(f.runtime.service);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.runtime.service.propagate = async function* (request, signal) {
    const iterator = original(request, signal);
    const first = await iterator.next();
    if (first.done !== true) {
      yield first.value;
    }
    await gate;
    yield* iterator;
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
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
});

it("accepts a fresh decode before React observes the native seek and hides stale geometry", async () => {
  const f = await fixture();
  pipeline.playerState.activeData.currentTime = fromNanoSec(550_000_000n);
  pipeline.playerState.activeData.lastSeekTime = 123;
  f.decode(5);
  f.rerender(f.view());
  expect(segmentationSession.getState().sourceReady).toBe(true);
  expect(segmentationSession.getState().decodedFrame?.frameId).toBe(f.frames[5]!.id);
  f.decode(4);
  expect(segmentationSession.getState().sourceReady).toBe(false);
  expect(f.container.querySelector('[data-testid="instance-union-fill"]')).toBeNull();
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
});

it.each(["provider", "source", "user"])(
  "fences native identity after %s changes",
  async (change) => {
    const f = await fixture();
    if (change === "provider") {
      f.decode(5, { providerId: "other" });
    } else if (change === "source") {
      f.decode(5, { source: { sourceId: "other.mp4", topic: "/camera", frames: [] } });
    } else {
      mockUserId = "other";
      f.rerender(f.view());
    }
    await flush();
    expect(segmentationSession.getState().open).toBe(false);
    expect(f.container.querySelector('[data-testid="segmentation-native-overlay"]')).toBeNull();
    expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  },
);
