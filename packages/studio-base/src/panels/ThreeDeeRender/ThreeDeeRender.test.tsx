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
const mockDecode = jest.fn();
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
    return Object.assign(new EventEmitter(), {
      config,
      schemaSubscriptions: new Map(),
      topicSubscriptions: new Map(),
      settings: { tree: () => ({}), handleAction: jest.fn() },
      measurementTool: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
      publishClickTool: {
        publishClickType: "point",
        setPublishClickType: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      setAnalytics: jest.fn(),
      setConfig: jest.fn(),
      setTopics: jest.fn(),
      setParameters: jest.fn(),
      setCameraSyncError: jest.fn(),
      setColorScheme: jest.fn(),
      getCameraState: () => config.cameraState,
      queueAnimationFrame: mockQueueRAF,
      processMessageEvents: mockEnqueue,
      dispose: mockDispose,
    });
  }),
}));

function mountPanel() {
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
  const view = render(<ThreeDeeRender context={context} interfaceMode="3d" testOptions={{}} />);
  return { context, view };
}
describe("onRender synchronous acknowledgement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBeforeRenderer = undefined;
    mockQueueRAF.mockReset();
    mockEnqueue.mockReset();
  });

  it("calls done before a per-renderable decode microtask", async () => {
    const { context, view } = mountPanel();
    const order: string[] = [];
    mockEnqueue.mockImplementation(() => {
      order.push("enqueue");
      queueMicrotask(() => {
        mockDecode();
        order.push("decode");
      });
    });
    mockQueueRAF.mockImplementation(() => order.push("raf"));
    const done = jest.fn(() => order.push("done"));
    act(() => {
      context.onRender!({ currentTime: fromNanoSec(1n) }, done);
    });
    expect(order).toEqual(["enqueue", "raf", "done"]);
    expect(done).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(order).toEqual(["enqueue", "raf", "done", "decode"]);
    view.unmount();
  });

  it.each(["ingest", "rAF"])("still calls done once if %s throws synchronously", (stage) => {
    const { context, view } = mountPanel();
    const done = jest.fn();
    const error = new Error(stage);
    if (stage === "ingest") {
      mockEnqueue.mockImplementation(() => {
        throw error;
      });
    } else {
      mockQueueRAF.mockImplementation(() => {
        throw error;
      });
    }
    act(() => {
      if (stage === "rAF") {
        expect(() => {
          context.onRender!({}, done);
        }).toThrow(error);
      } else {
        context.onRender!({}, done);
      }
    });
    expect(done).toHaveBeenCalledTimes(1);
    jest.mocked(console.error).mockClear();
    mockQueueRAF.mockReset();
    view.unmount();
  });

  it("acknowledges a tick before a renderer is available and retains only its latest snapshot", () => {
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
    const first = jest.fn();
    const last = jest.fn();
    mockBeforeRenderer = () => {
      context.onRender!({ currentFrame: [message("/old", 1n)] }, first);
      context.onRender!({ currentFrame: [message("/latest", 2n)] }, last);
    };
    const view = render(<ThreeDeeRender context={context} interfaceMode="3d" testOptions={{}} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ currentFrame: [message("/latest", 2n)], didSeek: false }),
    );
    view.unmount();
  });
});
