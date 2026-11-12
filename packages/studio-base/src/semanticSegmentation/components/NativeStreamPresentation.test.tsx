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
function renderOpportunity() {
  act(() => {
    const callbacks = [...rafs.values()];
    rafs.clear();
    callbacks.forEach((callback) => {
      callback(0);
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
    load() {
      fireEvent.load(result.container.querySelector("svg image")!);
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
});
afterEach(() => {
  const runtime = segmentationSession.getState().runtime;
  cleanup();
  runtime?.dispose();
});

it("holds actual embedded frames6/7/8 running through matched SVG load, overlay commit and render opportunity, then completes without rewind or extra seek", async () => {
  const f = await fixture();
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  let finalImage: Element | ReactNull = ReactNull;
  for (const [ordinal, index] of [5, 6, 7].entries()) {
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(ordinal + 1);
    expect(toNanoSec(pipeline.playerState.activeData.currentTime)).toBe(
      BigInt(index) * 100_000_000n,
    );
    expect(f.runtime.store.getState().propagation.status).toBe("running");
    f.event(); // Still-old decoded frame cannot acknowledge the new target.
    renderOpportunity();
    renderOpportunity();
    await flush();
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(ordinal + 1);
    f.decode(index);
    expect(segmentationSession.getState().sourceReady).toBe(true);
    expect(f.runtime.store.getState().currentFrameId).toBe(f.frames[index]!.id);
    expect(f.container.querySelector("svg image")?.getAttribute("href")).toContain(
      `frame${index + 1}`,
    );
    expect(f.container.querySelector('[data-testid="instance-union-fill"] path')).not.toBeNull();
    renderOpportunity();
    renderOpportunity();
    await flush(); // Decode+overlay without image load is insufficient.
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(ordinal + 1);
    expect(f.runtime.store.getState().propagation.status).toBe("running");
    f.load();
    renderOpportunity();
    await flush();
    expect(f.runtime.store.getState().propagation.status).toBe("running");
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(ordinal + 1);
    const oldImage = f.container.querySelector("svg image")!;
    f.decode(index); // A distinct decode with an identical URL must load its own image node.
    fireEvent.load(oldImage);
    renderOpportunity();
    renderOpportunity();
    await flush();
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(ordinal + 1);
    expect(f.runtime.store.getState().propagation.status).toBe("running");
    f.load();
    finalImage = f.container.querySelector("svg image");
    renderOpportunity();
    renderOpportunity();
    await flush();
  }
  await act(async () => {
    await running;
  });
  expect(f.runtime.store.getState().propagation.status).toBe("completed");
  expect(f.runtime.store.getState().currentFrameId).toBe(f.frames[7]!.id);
  expect(segmentationSession.getState().decodedFrame?.frameId).toBe(f.frames[7]!.id);
  expect(pipeline.seekPlayback).toHaveBeenCalledTimes(3);
  expect(f.container.querySelector("svg image")).toBe(finalImage);
});

it("STOP cancels pending RAFs and late decoding, retains accepted drafts, and stays stopping until the real400ms mock acknowledgement", async () => {
  const f = await fixture();
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  f.decode(5);
  f.load();
  renderOpportunity();
  const before = f.runtime.store.getState().stagedOperations;
  expect(rafs.size).toBeGreaterThan(0);
  jest.useFakeTimers();
  try {
    act(() => {
      f.runtime.store.getState().stopPropagation();
    });
    await flush();
    await act(async () => {
      await running;
    });
    expect(rafs.size).toBe(0);
    expect(f.runtime.store.getState().propagation.status).toBe("stopping");
    f.decode(6);
    renderOpportunity();
    renderOpportunity();
    expect(f.runtime.store.getState().stagedOperations).toBe(before);
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(399);
    });
    expect(f.runtime.store.getState().propagation.status).toBe("stopping");
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(f.runtime.store.getState().propagation.status).toBe("cancelled");
  } finally {
    jest.useRealTimers();
  }
});

it("accepts an already-decoded same-time target only after its new overlay render opportunity and does not issue a no-op seek", async () => {
  const f = await fixture();
  pipeline.playerState.activeData.currentTime = fromNanoSec(500_000_000n);
  f.decode(5);
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  expect(f.runtime.store.getState().propagation.status).toBe("running");
  f.load();
  renderOpportunity();
  renderOpportunity();
  await flush();
  expect(pipeline.seekPlayback).toHaveBeenCalledTimes(1); // Next frame7 only.
  act(() => {
    f.runtime.store.getState().stopPropagation();
  });
  await act(async () => {
    await running;
  });
});

it.each(["unmount", "provider", "source", "user", "image-error"])(
  "cleans pending display on %s and rejects its late acknowledgement",
  async (change) => {
    const f = await fixture();
    let running!: Promise<void>;
    act(() => {
      running = f.start();
    });
    await flush();
    f.decode(5);
    f.load();
    renderOpportunity();
    if (change === "unmount") {
      f.rerender(f.view("entry"));
    } else if (change === "provider") {
      f.decode(5, { providerId: "other-decoder" });
    } else if (change === "source") {
      f.decode(5, { source: { sourceId: "another-video.mp4", topic: "/camera", frames: [] } });
    } else if (change === "user") {
      mockUserId = "other-user";
      f.rerender(f.view());
    } else {
      fireEvent.error(f.container.querySelector("svg image")!);
    }
    await act(async () => {
      await running;
    });
    await flush();
    renderOpportunity();
    renderOpportunity();
    await flush();
    expect(f.runtime.store.getState().propagation.status).not.toBe("running");
    expect(f.runtime.store.getState().propagation.status).not.toBe("completed");
    expect(pipeline.seekPlayback).toHaveBeenCalledTimes(1);
    expect(f.runtime.store.getState().stagedOperations.length).toBeGreaterThanOrEqual(4);
  },
);

it("does not block a fresh decode delivered before React observes a changed native seek generation", async () => {
  const f = await fixture();
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  pipeline.playerState.activeData.lastSeekTime = 123;
  f.decode(5); // Decode event precedes pipeline rerender/layout effect.
  f.rerender(f.view());
  expect(segmentationSession.getState().sourceReady).toBe(true);
  f.load();
  renderOpportunity();
  renderOpportunity();
  await flush();
  expect(pipeline.seekPlayback).toHaveBeenCalledTimes(2);
  act(() => {
    f.runtime.store.getState().stopPropagation();
  });
  await act(async () => {
    await running;
  });
});

it("aborts the actual pending native display with no cancel seam but unlocks only after iterator termination", async () => {
  const f = await fixture();
  f.runtime.service.cancelPropagation = undefined;
  const original = f.runtime.service.propagate.bind(f.runtime.service);
  let finishIterator!: () => void;
  const terminal = new Promise<void>((resolve) => {
    finishIterator = resolve;
  });
  f.runtime.service.propagate = async function* (request, signal) {
    try {
      yield* original(request, signal);
    } finally {
      await terminal;
    }
  };
  let running!: Promise<void>;
  act(() => {
    running = f.start();
  });
  await flush();
  f.decode(5);
  f.load();
  renderOpportunity();
  const pending = segmentationSession.getState().presentation!;
  const drafts = f.runtime.store.getState().stagedOperations;
  act(() => {
    f.runtime.store.getState().stopPropagation();
  });
  await flush();
  expect(pending.signal.aborted).toBe(true);
  expect(rafs.size).toBe(0);
  expect(f.runtime.store.getState().propagation.status).toBe("stopping");
  expect(() => f.runtime.store.getState().addClass("still locked")).toThrow("Stop propagation");
  f.decode(6);
  renderOpportunity();
  renderOpportunity();
  await flush();
  expect(f.runtime.store.getState().propagation.status).toBe("stopping");
  expect(f.runtime.store.getState().stagedOperations).toBe(drafts);
  expect(pipeline.seekPlayback).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishIterator();
    await running;
  });
  expect(f.runtime.store.getState().propagation.status).toBe("cancelled");
  expect(f.runtime.store.getState().stagedOperations).toBe(drafts);
});
