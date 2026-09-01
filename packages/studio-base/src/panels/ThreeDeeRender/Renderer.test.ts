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

import { RendererConfig, RendererSubscription } from "./IRenderer";

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
  await renderer.processMessageEvents({
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

  it("draws synchronized topics at their publish timestamp without changing player time", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        synchronize: true,
        syncedTopics: { "/left": true, "/right": true },
        topics: { "/left": { visible: true }, "/right": { visible: true } },
      },
    });
    const contexts: unknown[] = [];
    renderer.schemaSubscriptions.set("foxglove.CompressedVideo", [
      {
        shouldSync: true,
        processQueue: (_queue, context) => {
          contexts.push(context);
        },
      },
    ]);
    renderer.setTopics([
      {
        name: "/left",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
      {
        name: "/right",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
    ]);

    const frameTimes: bigint[] = [];
    renderer.on("startFrame", (time) => frameTimes.push(time));
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(10n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        {
          topic: "/left",
          receiveTime: fromNanoSec(8n),
          schemaName: "foxglove.CompressedVideo",
          message: { timestamp: fromNanoSec(5n) },
          sizeInBytes: 0,
        },
        {
          topic: "/right",
          receiveTime: fromNanoSec(9n),
          schemaName: "foxglove.CompressedVideo",
          message: { timestamp: fromNanoSec(5n) },
          sizeInBytes: 0,
        },
      ],
    });
    renderer.animationFrame();

    expect(contexts).toEqual([
      expect.objectContaining({
        syncResult: expect.objectContaining({ found: true, timestamp: fromNanoSec(5n) }),
        syncTimestampChanged: true,
      }),
    ]);
    expect(frameTimes).toEqual([5n]);
    expect(renderer.currentTime).toBe(10n);
  });

  it("clears the synchronized frame immediately when a visible participant is removed", async () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        synchronize: true,
        syncedTopics: { "/left": true, "/right": true },
        topics: { "/left": { visible: true }, "/right": { visible: true } },
      },
    });
    renderer.schemaSubscriptions.set("foxglove.CompressedVideo", [
      { shouldSync: true, processQueue: () => {} },
    ]);
    renderer.setTopics([
      {
        name: "/left",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
      {
        name: "/right",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
    ]);

    const frameTimes: bigint[] = [];
    renderer.on("startFrame", (time) => frameTimes.push(time));
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(10n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        {
          topic: "/left",
          receiveTime: fromNanoSec(8n),
          schemaName: "foxglove.CompressedVideo",
          message: { timestamp: fromNanoSec(5n) },
          sizeInBytes: 0,
        },
        {
          topic: "/right",
          receiveTime: fromNanoSec(9n),
          schemaName: "foxglove.CompressedVideo",
          message: { timestamp: fromNanoSec(5n) },
          sizeInBytes: 0,
        },
      ],
    });
    renderer.animationFrame();

    renderer.updateConfig((draft) => {
      draft.topics["/right"] = { visible: false };
    });
    renderer.animationFrame();

    expect(frameTimes).toEqual([5n, 10n]);
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

  it("invalidates the synchronization epoch when registered publish timestamps regress", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const contexts: Parameters<
      Extract<RendererSubscription, { processQueue: unknown }>["processQueue"]
    >[1][] = [];
    renderer.schemaSubscriptions.set("foxglove.CompressedVideo", [
      {
        shouldSync: true,
        processQueue: (_queue, context) => {
          contexts.push(context);
        },
      },
    ]);
    renderer.config = {
      ...renderer.config,
      synchronize: true,
      syncedTopics: { "/left": true, "/right": true },
      topics: { "/left": { visible: true }, "/right": { visible: true } },
    };
    renderer.setTopics([
      {
        name: "/left",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
      {
        name: "/right",
        schemaName: "foxglove.CompressedVideo",
        messageCount: 0,
        messageFrequency: 0,
      },
    ]);
    const videoMessage = (topic: string, timestamp: bigint): MessageEvent => ({
      topic,
      receiveTime: fromNanoSec(timestamp),
      schemaName: "foxglove.CompressedVideo",
      message: { timestamp: fromNanoSec(timestamp) },
      sizeInBytes: 0,
    });

    await renderer.processMessageEvents({
      currentTime: fromNanoSec(100n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [videoMessage("/left", 100n), videoMessage("/right", 100n)],
    });
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(101n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [videoMessage("/left", 1n), videoMessage("/right", 1n)],
    });

    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toMatchObject({
      syncTimestampRegressed: true,
      syncResult: { found: true, timestamp: fromNanoSec(1n) },
    });
  });

  it("drains handlers before awaiting batch subscriptions and drawing", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const requestAnimationFrameSpy = jest.spyOn(window, "requestAnimationFrame");
    requestAnimationFrameSpy.mockClear();
    const order: string[] = [];
    let settleBatch: (() => void) | undefined;
    const batchSettled = new Promise<void>((resolve) => {
      settleBatch = resolve;
    });

    const handlerSubscription: RendererSubscription = {
      handler: () => order.push("handler"),
    };
    const batchSubscription: RendererSubscription = {
      processQueue: async () => {
        order.push("batch-start");
        await batchSettled;
        order.push("batch-end");
      },
    };
    renderer.topicSubscriptions.set("/state", [handlerSubscription]);
    renderer.topicSubscriptions.set("/video", [batchSubscription]);
    renderer.on("startFrame", () => order.push("draw"));

    const processing = renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/state" },
        { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/video" },
      ],
    });
    await Promise.resolve();

    expect(order).toEqual(["handler", "batch-start"]);
    renderer.queueAnimationFrame();
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
    renderer.animationFrame();
    expect(order).toEqual(["handler", "batch-start"]);

    settleBatch!();
    await processing;
    renderer.animationFrame();
    expect(order).toEqual(["handler", "batch-start", "batch-end", "draw"]);
  });

  it("does not let an older completed tick draw while a newer tick is decoding", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const frames: bigint[] = [];
    renderer.on("startFrame", (time) => frames.push(time));

    let releaseOld: (() => void) | undefined;
    const oldDecode = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let releaseNew: (() => void) | undefined;
    const newDecode = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    const started: bigint[] = [];
    renderer.topicSubscriptions.set("/video", [
      {
        processQueue: async (queue) => {
          const receiveTime = toNanoSec(queue[0]!.receiveTime);
          started.push(receiveTime);
          await (receiveTime === 1n ? oldDecode : newDecode);
        },
      },
    ]);

    const oldTick = renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/video" }],
    });
    const newTick = renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 2n, [2n]), topic: "/video" }],
    });
    await Promise.resolve();

    expect(started).toEqual([1n, 2n]);
    releaseOld!();
    await oldTick;
    renderer.animationFrame();
    expect(frames).toEqual([]);

    releaseNew!();
    await newTick;
    renderer.animationFrame();
    expect(frames).toEqual([2n]);
  });

  it("keeps a newer tick barrier pending when its decode finishes before an older tick", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const frames: bigint[] = [];
    renderer.on("startFrame", (time) => frames.push(time));

    let releaseOld: (() => void) | undefined;
    const oldDecode = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let releaseNew: (() => void) | undefined;
    const newDecode = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    renderer.topicSubscriptions.set("/video", [
      {
        processQueue: async (queue) => {
          await (toNanoSec(queue[0]!.receiveTime) === 1n ? oldDecode : newDecode);
        },
      },
    ]);

    const oldTick = renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/video" }],
    });
    const newTick = renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 2n, [2n]), topic: "/video" }],
    });
    let newBarrierSettled = false;
    void newTick.then(() => {
      newBarrierSettled = true;
    });
    await Promise.resolve();

    releaseNew!();
    await Promise.resolve();
    await Promise.resolve();
    expect(newBarrierSettled).toBe(false);
    renderer.animationFrame();
    expect(frames).toEqual([]);

    releaseOld!();
    await Promise.all([oldTick, newTick]);
    expect(newBarrierSettled).toBe(true);
    renderer.animationFrame();
    expect(frames).toEqual([2n]);
  });

  it("settles all batch subscriptions when one rejects", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const completed = jest.fn();
    const consoleError = console.error as jest.Mock;
    renderer.topicSubscriptions.set("/failed", [
      {
        processQueue: async () => {
          throw new Error("decode failed");
        },
      },
    ]);
    renderer.topicSubscriptions.set("/completed", [
      {
        processQueue: async () => {
          completed();
        },
      },
    ]);

    await expect(
      renderer.processMessageEvents({
        currentTime: fromNanoSec(1n),
        didSeek: false,
        allFrames: undefined,
        currentFrame: [
          { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/failed" },
          { ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/completed" },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "decode failed" }),
    );
    consoleError.mockClear();
  });

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

    await renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ ...createTFMessageEvent("a", "b", 1n, [1n]), topic: "/source" }],
    });
    expect(deferredHandler).not.toHaveBeenCalled();

    await renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: undefined,
    });
    expect(deferredHandler).toHaveBeenCalledTimes(1);
  });
});
