/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, act } from "@testing-library/react";
import EventEmitter from "eventemitter3";
import React from "react";

import { fromNanoSec } from "@foxglove/rostime";
import { Immutable, MessageEvent, RenderState } from "@foxglove/studio";
import { pauseFrameForPromises } from "@foxglove/studio-base/components/MessagePipeline/pauseFrameForPromise";
import type { BuiltinPanelExtensionContext } from "@foxglove/studio-base/components/PanelExtensionAdapter";

import type { RendererConfig } from "./IRenderer";
import { currentFrameForRenderTick, snapshotRenderState, ThreeDeeRender } from "./ThreeDeeRender";

jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

function message(topic: string, time: bigint): MessageEvent {
  return {
    topic,
    receiveTime: fromNanoSec(time),
    schemaName: "example.Message",
    message: {},
    sizeInBytes: 0,
  };
}

function renderState({
  time,
  currentFrame,
  allFrames,
  didSeek = false,
}: {
  time: bigint;
  currentFrame?: readonly MessageEvent[];
  allFrames?: readonly MessageEvent[];
  didSeek?: boolean;
}): Immutable<RenderState> {
  return {
    currentTime: fromNanoSec(time),
    currentFrame,
    allFrames,
    didSeek,
  };
}

describe("render tick snapshots", () => {
  it("detaches the reusable top-level state without copying persistent frame arrays", () => {
    const firstMessage = message("/first", 1n);
    const firstCurrentFrame = [firstMessage];
    const allFrames = [message("/static", 1n)];
    const reusedRenderState = renderState({
      time: 1n,
      currentFrame: firstCurrentFrame,
      allFrames,
    }) as RenderState;
    const firstSnapshot = snapshotRenderState(reusedRenderState);

    const latestMessage = message("/latest", 3n);
    reusedRenderState.currentTime = fromNanoSec(3n);
    reusedRenderState.currentFrame = [latestMessage];
    const latestSnapshot = snapshotRenderState(reusedRenderState);

    expect(firstSnapshot.currentFrame).toBe(firstCurrentFrame);
    expect(firstSnapshot.allFrames).toBe(allFrames);
    expect(latestSnapshot.currentFrame).toEqual([latestMessage]);
  });

  it("consumes a retained currentFrame identity only once across metadata and EOF renders", () => {
    const currentFrame = [message("/video", 1n)];
    const initialIdentity = Symbol("initial");

    expect(currentFrameForRenderTick(currentFrame, initialIdentity)).toBe(currentFrame);
    expect(currentFrameForRenderTick(currentFrame, currentFrame)).toBeUndefined();
    expect(currentFrameForRenderTick([], currentFrame)).toEqual([]);
  });
});

const mockEnqueue = jest.fn();
const mockQueueRAF = jest.fn();
const mockDraw = jest.fn();
let mockAutoSelect = false;
let mockSettingsTree = {};
const mockDispose = jest.fn();
const mockSnackbar = { enqueueSnackbar: jest.fn() };
let mockBeforeRenderer: (() => void) | undefined;
jest.mock("./RendererOverlay", () => ({ RendererOverlay: () => ReactNull }));
jest.mock("@foxglove/studio-base/theme/ThemeProvider", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@foxglove/studio-base/context/AnalyticsContext", () => ({
  useAnalytics: () => undefined,
}));
jest.mock("notistack", () => ({ useSnackbar: () => mockSnackbar }));
jest.mock("./Renderer", () => ({
  Renderer: jest.fn(({ config }: { config: RendererConfig }) => {
    mockBeforeRenderer?.();
    const instance = Object.assign(new EventEmitter(), {
      config,
      schemaSubscriptions: new Map(),
      topicSubscriptions: new Map(),
      settings: { tree: () => mockSettingsTree, handleAction: jest.fn() },
      measurementTool: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
      publishClickTool: {
        publishClickType: "point",
        setPublishClickType: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      setAnalytics: jest.fn(),
      setConfig: jest.fn((next: RendererConfig, options?: { emitChange?: boolean }) => {
        instance.config = next;
        instance.emit("configApplied", instance);
        if (options?.emitChange !== false) {
          instance.emit("configChange", instance);
        }
      }),
      setTopics: jest.fn((topics: RenderState["topics"]) => {
        mockSettingsTree = { topics: { label: topics?.[0]?.name ?? "Topics" } };
        instance.emit("settingsTreeChange", instance);
        if (
          mockAutoSelect &&
          topics != undefined &&
          topics.length > 0 &&
          instance.config.imageMode.imageTopic == undefined
        ) {
          instance.config = { ...instance.config, imageMode: { imageTopic: topics[0]!.name } };
          instance.emit("configChange", instance);
        }
      }),
      setParameters: jest.fn(),
      setCameraSyncError: jest.fn(),
      setColorScheme: jest.fn(),
      getCameraState: () => config.cameraState,
      queueAnimationFrame: mockQueueRAF,
      animationFrame: mockDraw,
      processMessageEvents: mockEnqueue,
      dispose: mockDispose,
    });
    return instance;
  }),
}));

function mountPanel(beforeRenderer?: (context: BuiltinPanelExtensionContext) => void) {
  const context = {
    initialState: {},
    saveState: jest.fn(),
    watch: jest.fn(),
    subscribe: jest.fn(),
    subscribeAppSettings: jest.fn(),
    updatePanelSettingsEditor: jest.fn(),
    unstable_setMessagePathDropConfig: jest.fn(),
    unstable_getPlaybackIsPlaying: () => true,
    layout: { addPanel: jest.fn() },
  } as unknown as BuiltinPanelExtensionContext;
  mockBeforeRenderer = beforeRenderer
    ? () => {
        beforeRenderer(context);
      }
    : undefined;
  const view = render(<ThreeDeeRender context={context} interfaceMode="3d" testOptions={{}} />);
  return { context, view };
}
async function flushRender() {
  await act(async () => {
    for (let i = 0; i < 24; i++) {
      await Promise.resolve();
    }
  });
}

describe("onRender awaited presentation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBeforeRenderer = undefined;
    mockAutoSelect = false;
    mockSettingsTree = {};
    mockQueueRAF.mockReset();
    mockDraw.mockReset();
    mockEnqueue.mockReset();
  });

  it("waits for decode, draws, and only then acknowledges the tick", async () => {
    const { context, view } = mountPanel();
    let release!: () => void;
    const decode = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    mockEnqueue.mockImplementation(async () => {
      await decode.then(() => {
        order.push("pixels and metadata");
      });
    });
    mockDraw.mockImplementation(() => {
      order.push("draw");
    });
    const done = jest.fn(() => {
      order.push("done");
    });
    act(() => {
      context.onRender!({ currentTime: fromNanoSec(1n) }, done);
    });
    await flushRender();
    expect(done).not.toHaveBeenCalled();
    expect(mockDraw).not.toHaveBeenCalled();
    release();
    await flushRender();
    expect(order).toEqual(["pixels and metadata", "draw", "done"]);
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("keeps the global frame waiting for the slower of two panels", async () => {
    const fast = mountPanel();
    const slow = mountPanel();
    let releaseSlow!: () => void;
    mockEnqueue.mockResolvedValueOnce(undefined).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseSlow = resolve;
      }),
    );
    let fastDone!: () => void;
    let slowDone!: () => void;
    const fastFrame = new Promise<void>((resolve) => {
      fastDone = resolve;
    });
    const slowFrame = new Promise<void>((resolve) => {
      slowDone = resolve;
    });
    let frameComplete = false;
    const globalFrame = pauseFrameForPromises([
      { name: "fast", promise: fastFrame },
      { name: "slow", promise: slowFrame },
    ]).then(() => {
      frameComplete = true;
    });
    act(() => {
      fast.context.onRender!({}, fastDone);
      slow.context.onRender!({}, slowDone);
    });
    await flushRender();
    expect(mockDraw).toHaveBeenCalledTimes(1);
    expect(frameComplete).toBe(false);
    releaseSlow();
    await flushRender();
    await globalFrame;
    expect(mockDraw).toHaveBeenCalledTimes(2);
    expect(frameComplete).toBe(true);
    fast.view.unmount();
    slow.view.unmount();
  });

  it.each(["ingest", "draw"])("releases done once when %s fails", async (stage) => {
    const { context, view } = mountPanel();
    const fail = () => {
      throw new Error(stage);
    };
    if (stage === "ingest") {
      mockEnqueue.mockImplementation(fail);
    } else {
      mockDraw.mockImplementation(fail);
    }
    const done = jest.fn();
    act(() => {
      context.onRender!({}, done);
    });
    await flushRender();
    expect(done).toHaveBeenCalledTimes(1);
    jest.mocked(console.error).mockClear();
    view.unmount();
  });

  it("releases an unmounted tick and never draws its late result", async () => {
    const { context, view } = mountPanel();
    let release!: () => void;
    mockEnqueue.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const done = jest.fn();
    act(() => {
      context.onRender!({}, done);
    });
    await flushRender();
    view.unmount();
    expect(done).toHaveBeenCalledTimes(1);
    release();
    await flushRender();
    expect(mockDraw).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("releases a replaced renderer and ignores its late decode", async () => {
    const { context, view } = mountPanel();
    let releaseOld!: () => void;
    mockEnqueue
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseOld = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    const done = jest.fn();
    act(() => {
      context.onRender!({ currentTime: fromNanoSec(1n) }, done);
    });
    await flushRender();
    expect(done).not.toHaveBeenCalled();
    view.rerender(
      <ThreeDeeRender context={context} interfaceMode="3d" testOptions={{ debugPicking: true }} />,
    );
    await flushRender();
    expect(done).toHaveBeenCalledTimes(1);
    expect(mockDispose).toHaveBeenCalledTimes(1);
    const draws = mockDraw.mock.calls.length;
    releaseOld();
    await flushRender();
    expect(mockDraw).toHaveBeenCalledTimes(draws);
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("publishes settings populated during retained-state replay and renderer replacement", async () => {
    const topics = [{ name: "/image", schemaName: "foxglove.CompressedImage" }];
    const { context, view } = mountPanel((panel) => {
      panel.onRender!({ topics }, jest.fn());
    });
    const updateSettings = jest.spyOn(context, "updatePanelSettingsEditor");
    await flushRender();
    expect(updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodes: { topics: { label: "/image" } } }),
    );
    mockSettingsTree = {};
    view.rerender(
      <ThreeDeeRender context={context} interfaceMode="3d" testOptions={{ debugPicking: true }} />,
    );
    await flushRender();
    expect(updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodes: { topics: { label: "/image" } } }),
    );
    view.unmount();
  });

  it("retains initialization topic selection without echoing the old React config", async () => {
    mockAutoSelect = true;
    const { context, view } = mountPanel((panel) => {
      panel.onRender!(
        {
          topics: [
            {
              name: "/image",
              schemaName: "foxglove.RawImage",
              messageCount: 1,
              messageFrequency: 1,
            },
          ],
        },
        jest.fn(),
      );
    });
    await flushRender();
    // Inspect the real component's saved React configuration after the replay and config effects.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1050));
    });
    expect(context.saveState).toHaveBeenLastCalledWith(
      expect.objectContaining({ imageMode: { imageTopic: "/image" } }),
    );
    view.unmount();
  });

  it("replays only the latest snapshot received before renderer creation", async () => {
    const done = jest.fn();
    const { view } = mountPanel((context) => {
      context.onRender!({ currentFrame: [message("/old", 1n)] }, done);
      context.onRender!({ currentFrame: [message("/latest", 2n)] }, done);
    });
    await flushRender();
    expect(done).toHaveBeenCalledTimes(2);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ currentFrame: [message("/latest", 2n)], didSeek: false }),
    );
    view.unmount();
  });
});
