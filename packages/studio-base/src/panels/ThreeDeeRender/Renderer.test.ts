/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { Renderer } from "@foxglove/studio-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@foxglove/studio-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "@foxglove/studio-base/panels/ThreeDeeRender/camera";
import { CameraStateSettings } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/CameraStateSettings";
import { DEFAULT_PUBLISH_SETTINGS } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/PublishSettings";
import { TFMessage } from "@foxglove/studio-base/panels/ThreeDeeRender/ros";

import { RendererConfig } from "./IRenderer";

// Jest doesn't support ES module imports fully yet, so we need to mock the wasm file
jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

// We need to mock the WebGLRenderer because it's not available in jsdom
// only mocking what we currently use
jest.mock("three", () => {
  const THREE = jest.requireActual("three");
  return {
    ...THREE,
    WebGLRenderer: function WebGLRenderer() {
      return {
        capabilities: {
          isWebGL2: true,
        },

        setPixelRatio: jest.fn(),
        setSize: jest.fn(),
        render: jest.fn(),
        clear: jest.fn(),
        setClearColor: jest.fn(),
        readRenderTargetPixels: jest.fn(),
        info: {
          reset: jest.fn(),
        },
        shadowMap: {},
        dispose: jest.fn(),
        clearDepth: jest.fn(),
        getDrawingBufferSize: () => ({ width: 100, height: 100 }),
      };
    },
  };
});

beforeEach(() => {
  // Copied from: https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
  // mock matchMedia for `Renderer` class in ThreeDeeRender
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: ReactNull,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

const defaultRendererConfig: RendererConfig = {
  cameraState: DEFAULT_CAMERA_STATE,
  followMode: "follow-pose",
  followTf: undefined,
  scene: {},
  transforms: {},
  topics: {},
  layers: {},
  publish: DEFAULT_PUBLISH_SETTINGS,
  imageMode: {},
};

const makeTf = () => ({
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
});

function createTFMessageEvent(
  parentId: string,
  childId: string,
  receiveTime: bigint,
  headerStamps: bigint[],
  topic: string = "/tf",
): MessageEvent<TFMessage> {
  const stampedTfs = headerStamps.map((stamp) => ({
    header: {
      stamp: fromNanoSec(stamp),
      frame_id: parentId,
    },
    child_frame_id: childId,
    transform: makeTf(),
  }));
  return {
    topic,
    receiveTime: fromNanoSec(receiveTime),
    schemaName: "tf2_msgs/TFMessage",
    message: {
      transforms: stampedTfs,
    },
    sizeInBytes: 0,
  };
}

const fetchAsset = async (uri: string, options?: { signal?: AbortSignal }): Promise<Asset> => {
  const response = await fetch(uri, options);
  return {
    uri,
    data: new Uint8Array(await response.arrayBuffer()),
    mediaType: response.headers.get("content-type") ?? undefined,
  };
};
const defaultRendererProps = {
  config: defaultRendererConfig,
  interfaceMode: "3d" as const,
  fetchAsset,
  sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
  testOptions: {},
};

async function processQueuedMessagesAndDraw(renderer: Renderer): Promise<void> {
  renderer.processMessageEvents({
    currentTime: fromNanoSec(renderer.currentTime),
    didSeek: false,
    allFrames: undefined,
    currentFrame: undefined,
  });
  renderer.animationFrame();
}

describe("3D Renderer", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  beforeEach(() => {
    jest.clearAllMocks();
    setupJestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
  });
  afterEach(() => {
    (console.warn as jest.Mock).mockClear();
  });

  it("constructs a renderer without error", () => {
    expect(() => new Renderer({ ...defaultRendererProps, canvas })).not.toThrow();
  });

  it("cancels and ignores a queued animation frame after disposal", () => {
    const requestAnimationFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 42);
    const cancelAnimationFrame = jest.spyOn(window, "cancelAnimationFrame");
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const gl = renderer.gl as unknown as { clear: jest.Mock };

    requestAnimationFrame.mock.calls.at(-1)?.[0](0);
    requestAnimationFrame.mockClear();
    cancelAnimationFrame.mockClear();

    renderer.queueAnimationFrame();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    const staleFrame = requestAnimationFrame.mock.calls[0]![0];
    renderer.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);

    gl.clear.mockClear();
    staleFrame(0);
    renderer.queueAnimationFrame();
    expect(gl.clear).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("does not set a unfollow pose snapshot  when in follow-pose mode", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        followMode: "follow-pose",
        followTf: "display",
        scene: { transforms: { enablePreloading: false } },
      },
    });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    await processQueuedMessagesAndDraw(renderer);

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    await processQueuedMessagesAndDraw(renderer);
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
  });
  it("records pose snapshot after changing from follow-pose mode to follow-none", async () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-pose" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    await processQueuedMessagesAndDraw(renderer);

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    await processQueuedMessagesAndDraw(renderer);
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
    renderer.config = { ...config, followMode: "follow-none" };
    renderer.animationFrame();
    // parent is the camera group that holds the pose from the snapshot
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
  it("sets pose snapshot to undefined after changing from follow-none mode to follow-pose", async () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-none" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    await processQueuedMessagesAndDraw(renderer);

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    await processQueuedMessagesAndDraw(renderer);
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    renderer.config = { ...config, followMode: "follow-pose" };
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
  });
  it("keeps same unfollowPoseSnapshot when switching from follow-none to follow-position", async () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-none" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    await processQueuedMessagesAndDraw(renderer);

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    await processQueuedMessagesAndDraw(renderer);
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    renderer.config = { ...config, followMode: "follow-position" };
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
  it("in fixed follow mode: ensures that the unfollowPoseSnapshot updates when there is a new fixedFrame", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        followMode: "follow-none",
        followTf: "display",
        scene: { transforms: { enablePreloading: false } },
      },
    });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    await processQueuedMessagesAndDraw(renderer);

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.fixedFrameId).toEqual("parentOfDisplay");
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });

    const tfWithFinalRoot = createTFMessageEvent("root", "parentOfDisplay", 1n, [1n]);
    tfWithFinalRoot.message.transforms[0]!.transform.translation.y = 1;
    renderer.addMessageEvent(tfWithFinalRoot);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.fixedFrameId).toEqual("root");
    // combines the two translations
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 1,
      z: 0,
    });
  });

  it("tfPreloading off:  when seeking to before currentTime, clears transform tree", async () => {
    // This test is meant accurately represent the flow of seek through the react component

    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    let currentFrame = [];

    // initialize renderer with transforms

    // first frame
    let currentTime = 5n;
    const beforeHeader = createTFMessageEvent("root", "before", currentTime, [currentTime - 2n]);
    // transform with headerstamp before currentTime
    currentFrame = [beforeHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // second frame
    currentTime = 6n;
    const onHeader = createTFMessageEvent("root", "on", currentTime, [currentTime]);
    // transform with headerstamp on currentTime
    currentFrame = [onHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // third frame
    currentTime = 7n;
    const afterHeader = createTFMessageEvent("root", "after", currentTime, [currentTime + 2n]);
    // transform with headerstamp after currentTime
    currentFrame = [afterHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    await processQueuedMessagesAndDraw(renderer);

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();

    //seek to 5n

    const oldTime = currentTime;
    currentTime = 5n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should have cleared transforms so that no future-to-the-currentTime transforms are in the tree
    expect(renderer.transformTree.frame("before")).toBeUndefined();
    expect(renderer.transformTree.frame("on")).toBeUndefined();
    expect(renderer.transformTree.frame("after")).toBeUndefined();
    // currentFrame will be set back to what it was at that time
    currentFrame = [beforeHeader];
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    await processQueuedMessagesAndDraw(renderer);

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
  });
  it("tfPreloading off: when seeking to time after currentTime, does not clear transform tree", async () => {
    // This test is meant accurately represent the flow of seek through the react component

    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    let currentFrame = [];

    // initialize renderer with transforms

    // first frame
    let currentTime = 5n;
    const beforeHeader = createTFMessageEvent("root", "before", currentTime, [currentTime - 2n]);
    // transform with headerstamp before currentTime
    currentFrame = [beforeHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // second frame
    currentTime = 6n;
    const onHeader = createTFMessageEvent("root", "on", currentTime, [currentTime]);
    // transform with headerstamp on currentTime
    currentFrame = [onHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // third frame
    currentTime = 7n;
    const afterHeader = createTFMessageEvent("root", "after", currentTime, [currentTime + 2n]);
    // transform with headerstamp after currentTime
    currentFrame = [afterHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    await processQueuedMessagesAndDraw(renderer);

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();

    //seek to 10n (forward)

    const oldTime = currentTime;
    currentTime = 10n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should not have cleared transforms
    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();
    // currentFrame will be set back to what it was at that time
    const seekOnHeader = createTFMessageEvent("root", "seekOn", currentTime, [currentTime]);
    currentFrame = [seekOnHeader];
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    await processQueuedMessagesAndDraw(renderer);

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();
    expect(renderer.transformTree.frame("seekOn")).not.toBeUndefined();
  });
  it("tfPreloading on:  when seeking to before currentTime, clears transform tree and repopulates it up to receiveTime from allFrames", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: true } },
      },
    });
    const allFrames = [
      createTFMessageEvent("root", "before4", 5n, [1n]),
      createTFMessageEvent("root", "before2", 6n, [4n]),
      createTFMessageEvent("root", "on", 7n, [7n]),
      createTFMessageEvent("root", "after2", 8n, [10n]),
      createTFMessageEvent("root", "after4", 9n, [13n]),
    ];

    // initialize renderer with transforms
    let currentTime = 8n;
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(allFrames);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.transformTree.frame("before4")).not.toBeUndefined();
    expect(renderer.transformTree.frame("before2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after4")).toBeUndefined();

    //seek to 6n (backwards)

    const oldTime = currentTime;
    currentTime = 6n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should have cleared transforms so that no future-to-the-currentTime transforms are in the tree
    expect(renderer.transformTree.frame("before4")).toBeUndefined();
    expect(renderer.transformTree.frame("before2")).toBeUndefined();
    expect(renderer.transformTree.frame("on")).toBeUndefined();
    expect(renderer.transformTree.frame("after2")).toBeUndefined();
    expect(renderer.transformTree.frame("after4")).toBeUndefined();

    // repopulate up to current receiveTime from allFrames
    renderer.handleAllFramesMessages(allFrames);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.transformTree.frame("before4")).not.toBeUndefined();
    expect(renderer.transformTree.frame("before2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).toBeUndefined();
    expect(renderer.transformTree.frame("after2")).toBeUndefined();
    expect(renderer.transformTree.frame("after4")).toBeUndefined();
  });
  it("tfPreloading on: does not clear transform tree when seeking to after", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: true } },
      },
    });
    const allFrames = [
      createTFMessageEvent("root", "before4", 5n, [1n]),
      createTFMessageEvent("root", "before2", 6n, [4n]),
      createTFMessageEvent("root", "on", 7n, [7n]),
      createTFMessageEvent("root", "after2", 8n, [10n]),
      createTFMessageEvent("root", "after4", 9n, [13n]),
    ];

    // initialize renderer with normal transforms
    let currentTime = 7n;
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(allFrames);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.transformTree.frame("before4")).not.toBeUndefined();
    expect(renderer.transformTree.frame("before2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after2")).toBeUndefined();
    expect(renderer.transformTree.frame("after4")).toBeUndefined();

    //seek to 9n (forwards)

    const oldTime = currentTime;
    currentTime = 9n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should not have cleared tree, so should be same as before
    expect(renderer.transformTree.frame("before4")).not.toBeUndefined();
    expect(renderer.transformTree.frame("before2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after2")).toBeUndefined();
    expect(renderer.transformTree.frame("after4")).toBeUndefined();

    // repopulate up to current receiveTime from allFrames
    renderer.handleAllFramesMessages(allFrames);
    await processQueuedMessagesAndDraw(renderer);
    expect(renderer.transformTree.frame("before4")).not.toBeUndefined();
    expect(renderer.transformTree.frame("before2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after2")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after4")).not.toBeUndefined();
  });
});

describe("Renderer.handleAllFramesMessages behavior", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  let rendererArgs: ConstructorParameters<typeof Renderer>[0] = {
    ...defaultRendererProps,
    canvas,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    setupJestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    rendererArgs = { ...rendererArgs, canvas };
  });
  afterEach(() => {
    (console.warn as jest.Mock).mockClear();
  });

  it("constructs a renderer without error", () => {
    expect(() => new Renderer(rendererArgs)).not.toThrow();
  });
  it("does not add in allFramesMessages if no messages are before currentTime", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(10 + i), [BigInt(i)]));
    }
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    const currentTime = 5n;
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).not.toHaveBeenCalled();
  });
  it("adds messages with receiveTime up to currentTime", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const currentTime = 4n;
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(msgs);

    expect(addMessageEventMock).toHaveBeenCalledTimes(5);
  });
  it("adds later messages after currentTime is updated", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const currentTime = 4n;
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(5);
    renderer.setCurrentTime(5n);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(6);
  });
  it("reads all messages when last message receiveTime is before currentTime", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const currentTime = 11n;
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(10);
  });
  it("reads reads new messages when allFrames array is added to", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    let i = 0;
    for (i; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const currentTime = 11n;
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(currentTime);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(10);
    for (i; i < 20; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    renderer.handleAllFramesMessages(msgs);
    // only two more are before or equal to currentTime
    expect(addMessageEventMock).toHaveBeenCalledTimes(12);
  });
  it("doesn't read messages when currentTime is updated but no more receiveTimes are past it", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    let i = 0;
    for (i; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(11n);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(10);

    renderer.setCurrentTime(12n);
    const newMessagesHandled = renderer.handleAllFramesMessages(msgs);
    expect(newMessagesHandled).toBeFalsy();
    expect(addMessageEventMock).toHaveBeenCalledTimes(10);
  });
  it("adds all messages again after cursor is cleared", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    let i = 0;
    for (i; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(11n);
    renderer.handleAllFramesMessages(msgs);
    expect(addMessageEventMock).toHaveBeenCalledTimes(10);

    renderer.clear({ resetAllFramesCursor: true });
    const newMessagesHandled = renderer.handleAllFramesMessages(msgs);
    expect(newMessagesHandled).toBeTruthy();
    // will read all messages in twice
    expect(addMessageEventMock).toHaveBeenCalledTimes(20);
  });
  it("resets cursor if messages were added before the cursor index", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    let i = 2;
    for (i; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(5n);
    renderer.handleAllFramesMessages(msgs);
    const numMessagesBeforeTime = msgs.filter(
      (msg) => toNanoSec(msg.message.transforms[0]!.header.stamp) <= 5n,
    ).length;
    expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime);

    addMessageEventMock.mockClear();

    // add message to beginning of array, before cursor
    msgs.unshift(createTFMessageEvent("a", "b", 1n, [1n]));

    const newMessagesHandled = renderer.handleAllFramesMessages(msgs);
    expect(newMessagesHandled).toBeTruthy();
    // will read from the beginning of the array again  because cursor was reset
    expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime + 1);
  });
  it("resets cursor if messages were removed before the cursor index", () => {
    const renderer = new Renderer(rendererArgs);

    const msgs = [];
    let i = 2;
    for (i; i < 10; i++) {
      msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
    }
    const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
    renderer.setCurrentTime(5n);
    renderer.handleAllFramesMessages(msgs);
    const numMessagesBeforeTime = msgs.filter(
      (msg) => toNanoSec(msg.message.transforms[0]!.header.stamp) <= 5n,
    ).length;
    expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime);

    addMessageEventMock.mockClear();

    // remove message at beginning of array, before cursor
    msgs.shift();

    const newMessagesHandled = renderer.handleAllFramesMessages(msgs);
    expect(newMessagesHandled).toBeTruthy();
    // will read from the beginning of the array again  because cursor was reset
    expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime - 1);
  });
  it.failing(
    "(does not) reset the cursor if number of messages added **and** removed before cursor are equal in a single update",
    () => {
      const renderer = new Renderer(rendererArgs);

      const msgs = [];
      let i = 2;
      for (i; i < 10; i++) {
        msgs.push(createTFMessageEvent("a", "b", BigInt(i), [BigInt(i)]));
      }
      const addMessageEventMock = jest.spyOn(renderer, "addMessageEvent");
      renderer.setCurrentTime(5n);
      renderer.handleAllFramesMessages(msgs);
      const numMessagesBeforeTime = msgs.filter(
        (msg) => toNanoSec(msg.message.transforms[0]!.header.stamp) <= 5n,
      ).length;
      expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime);

      addMessageEventMock.mockClear();

      // remove message at beginning of array, before cursor
      msgs.shift();

      // add message to beginning of array, before cursor
      msgs.unshift(createTFMessageEvent("a", "b", 1n, [1n]));

      const newMessagesHandled = renderer.handleAllFramesMessages(msgs);
      expect(newMessagesHandled).toBeTruthy();
      // will read from the beginning of the array again  because cursor was reset
      expect(addMessageEventMock).toHaveBeenCalledTimes(numMessagesBeforeTime - 1);
    },
  );

  it("defers messages enqueued by a handler until the next tick", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const deferredMessage = {
      ...createTFMessageEvent("a", "b", 2n, [2n]),
      topic: "/deferred",
    };
    const deferredHandler = jest.fn();
    renderer.topicSubscriptions.set("/source", [
      {
        handler: () => {
          renderer.addMessageEvent(deferredMessage);
        },
      },
    ]);
    renderer.topicSubscriptions.set("/deferred", [{ handler: deferredHandler }]);

    renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/source" }],
    });
    expect(deferredHandler).not.toHaveBeenCalled();

    renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: undefined,
    });
    expect(deferredHandler).toHaveBeenCalledTimes(1);
  });
  it("ingests synchronously, leaves a queued rAF intact, and draws while decode is active", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const order: string[] = [];
    let resolve!: () => void;
    const decode = new Promise<void>((done) => {
      resolve = done;
    });
    renderer.topicSubscriptions.set("/state", [{ handler: () => order.push("handler") }]);
    renderer.topicSubscriptions.set("/video", [
      {
        processQueue: () => {
          order.push("enqueue");
          queueMicrotask(() => {
            order.push("decode");
            void decode.then(() => order.push("settled"));
          });
        },
      },
    ]);
    renderer.on("startFrame", () => order.push("draw"));
    const cancel = jest.spyOn(window, "cancelAnimationFrame");
    renderer.queueAnimationFrame();
    // oxlint-disable-next-line typescript/no-confusing-void-expression -- Assert the void ingestion contract.
    const result = renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/video" },
        { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/state" },
      ],
    });
    order.push("done");
    expect(result).toBeUndefined();
    expect(order).toEqual(["handler", "enqueue", "done"]);
    expect(cancel).not.toHaveBeenCalled();
    await Promise.resolve();
    renderer.animationFrame();
    expect(order).toEqual(["handler", "enqueue", "done", "decode", "draw"]);
    resolve();
    await Promise.resolve();
    renderer.animationFrame();
    expect(order.filter((event) => event === "enqueue")).toHaveLength(1);
    renderer.dispose();
    cancel.mockRestore();
  });

  it("keeps Player time even with deprecated synchronization configuration", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererProps.config,
        synchronize: true,
        syncedTopics: { "/video": true },
      },
    });
    const start = jest.fn();
    renderer.on("startFrame", start);
    renderer.processMessageEvents({
      currentTime: fromNanoSec(123n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: undefined,
    });
    renderer.animationFrame();
    expect(start).toHaveBeenCalledWith(123n, renderer);
    expect(renderer.config.synchronize).toBe(true);
    renderer.dispose();
  });

  it("excludes direct and converted video from allFrames but retains TF preloading", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.setTopics([
      {
        name: "/converted",
        schemaName: "custom.Video",
        convertibleTo: ["foxglove.CompressedVideo"],
        messageCount: 1,
        messageFrequency: 30,
      },
    ]);
    const add = jest.spyOn(renderer, "addMessageEvent");
    const tf = createTFMessageEvent("a", "b", 1n, [1n]);
    renderer.currentTime = 100n;
    renderer.handleAllFramesMessages([
      { ...tf, topic: "/video", schemaName: "foxglove.CompressedVideo" },
      { ...tf, topic: "/converted", schemaName: "custom.Video" },
      tf,
    ]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(tf);
    renderer.dispose();
  });

  it("recovers rendering state after a frame listener throws", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const fail = () => {
      throw new Error("draw");
    };
    renderer.on("startFrame", fail);
    expect(() => {
      renderer.animationFrame();
    }).toThrow("draw");
    renderer.off("startFrame", fail);
    const next = jest.fn();
    renderer.on("startFrame", next);
    renderer.animationFrame();
    expect(next).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it("detects EOF even if isPlaying has not changed", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.getPlaybackIsPlaying = () => true;
    renderer.endTime = 10n;
    renderer.currentTime = 9n;
    expect(renderer.isPlaybackStopped()).toBe(false);
    renderer.currentTime = 10n;
    expect(renderer.isPlaybackStopped()).toBe(true);
    renderer.dispose();
  });
});
