/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";

import { H264 } from "@foxglove/den/video";
import { Time, toNanoSec } from "@foxglove/rostime";
import { Immutable, MessageEvent } from "@foxglove/studio";
import { HUDItemManager } from "@foxglove/studio-base/panels/ThreeDeeRender/HUDItemManager";
import {
  IRenderer,
  type RendererSubscriptionContext,
} from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import {
  type CompressedVideoFrameEvent,
  ImageRenderable,
  ImageSetImageResult,
  ImageUserData,
  type SetCompressedVideoFramesOptions,
} from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/ImageRenderable";
import { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { ImageMode } from "./ImageMode";
import {
  IMessageHandler,
  MessageRenderState,
  WAITING_FOR_IMAGE_EMPTY_HUD_ITEM,
  WAITING_FOR_IMAGE_NOTICE_HUD_ITEM,
} from "./MessageHandler";
import { ConfigWithDefaults } from "./types";
import { AnyImage, CompressedVideo } from "../Images/ImageTypes";

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeVideoMessage(timestamp: bigint, type: "key" | "delta"): MessageEvent<CompressedVideo> {
  return {
    topic: "/camera",
    schemaName: "foxglove.CompressedVideo",
    receiveTime: timeFromNanoseconds(timestamp),
    message: {
      timestamp: timeFromNanoseconds(timestamp),
      frame_id: "camera",
      format: "h264",
      data: new Uint8Array([type === "key" ? 0x65 : 0x41]),
    },
    sizeInBytes: 1,
  };
}

function makeRawImageMessage(timestamp: bigint): MessageEvent<AnyImage> {
  const time = timeFromNanoseconds(timestamp);
  return {
    topic: "/camera",
    schemaName: "foxglove.RawImage",
    receiveTime: time,
    message: {
      timestamp: time,
      frame_id: "camera",
      width: 1,
      height: 1,
      encoding: "mono8",
      step: 1,
      data: new Uint8Array([0]),
    },
    sizeInBytes: 1,
  };
}

function timestampFromImage(image: AnyImage): Time {
  return "header" in image ? image.header.stamp : image.timestamp;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 24; i++) {
    await Promise.resolve();
  }
}

const PLAYBACK_CONTEXT: RendererSubscriptionContext = {
  didSeek: false,
};

const SEEK_CONTEXT: RendererSubscriptionContext = {
  ...PLAYBACK_CONTEXT,
  didSeek: true,
};

class FakeMessageHandler implements IMessageHandler {
  public readonly canDisplayImage: IMessageHandler["canDisplayImage"] = jest.fn(() => true);
  public readonly handleRosRawImage: IMessageHandler["handleRosRawImage"] = jest.fn();
  public readonly handleRosCompressedImage: IMessageHandler["handleRosCompressedImage"] = jest.fn();
  public readonly handleRawImage: IMessageHandler["handleRawImage"] = jest.fn();
  public readonly handleCompressedImage: IMessageHandler["handleCompressedImage"] = jest.fn();
  public readonly handleCompressedVideo: IMessageHandler["handleCompressedVideo"] = jest.fn();
  public readonly recordCompressedVideo: IMessageHandler["recordCompressedVideo"] = jest.fn();
  public readonly recordCompressedVideoFrames: IMessageHandler["recordCompressedVideoFrames"] =
    jest.fn((messageEvents) => {
      for (const messageEvent of messageEvents) {
        this.recordCompressedVideo(messageEvent);
      }
    });
  public readonly consumeTimestampRegression: IMessageHandler["consumeTimestampRegression"] =
    jest.fn(() => false);
  public readonly handleRemoteVideoFrameReference: IMessageHandler["handleRemoteVideoFrameReference"] =
    jest.fn();
  public readonly updateImageState: IMessageHandler["updateImageState"] = jest.fn();
  public readonly handleCameraInfo: IMessageHandler["handleCameraInfo"] = jest.fn();
  public readonly handleAnnotations: IMessageHandler["handleAnnotations"] = jest.fn();
  public readonly setConfig: IMessageHandler["setConfig"] = jest.fn();
  public readonly clear: IMessageHandler["clear"] = jest.fn();
  public readonly getRenderStateAndUpdateHUD: IMessageHandler["getRenderStateAndUpdateHUD"] =
    jest.fn((): MessageRenderState => ({ annotationsByTopic: new Map() }));
  public readonly refreshHUD: IMessageHandler["refreshHUD"] = jest.fn();
  public readonly setAvailableAnnotationTopics: IMessageHandler["setAvailableAnnotationTopics"] =
    jest.fn();

  #listeners: Parameters<IMessageHandler["addListener"]>[0][] = [];

  public addListener(listener: Parameters<IMessageHandler["addListener"]>[0]): void {
    this.#listeners.push(listener);
  }

  public removeListener(listener: Parameters<IMessageHandler["addListener"]>[0]): void {
    this.#listeners = this.#listeners.filter((existing) => existing !== listener);
  }

  public emitState(newState: MessageRenderState, oldState: MessageRenderState | undefined): void {
    for (const listener of this.#listeners) {
      listener(newState, oldState);
    }
  }
}

class EmittingUpdateImageStateMessageHandler extends FakeMessageHandler {
  public override readonly updateImageState: IMessageHandler["updateImageState"] = jest.fn(
    (messageEvent, image) => {
      this.emitState({ image: { ...messageEvent, message: image } }, undefined);
    },
  );
}

class SynchronizingCompressedVideoMessageHandler extends FakeMessageHandler {
  public override readonly canDisplayImage: IMessageHandler["canDisplayImage"] = jest.fn(
    (event) => this.target?.message.data === (event.message as CompressedVideo).data,
  );
  public target: MessageEvent<CompressedVideo> | undefined;
  #matchedTarget: MessageEvent<CompressedVideo> | undefined;

  public completeTarget(target: MessageEvent<CompressedVideo>): void {
    this.target = target;
    this.#matchedTarget = target;
  }

  public override readonly recordCompressedVideo: IMessageHandler["recordCompressedVideo"] =
    jest.fn((messageEvent) => {
      const timestamp = messageEvent.message.timestamp;
      if (
        this.target != undefined &&
        timestamp?.sec != undefined &&
        timestamp.nsec != undefined &&
        toNanoSec(this.target.message.timestamp) === toNanoSec(timestamp as Time)
      ) {
        this.#matchedTarget = this.target;
      }
    });

  public override readonly getRenderStateAndUpdateHUD: IMessageHandler["getRenderStateAndUpdateHUD"] =
    jest.fn(
      (): MessageRenderState => ({
        image: this.#matchedTarget,
        annotationsByTopic: new Map(),
      }),
    );
}

class PlaybackCompressedVideoMessageHandler extends FakeMessageHandler {
  public override readonly handleCompressedVideo: IMessageHandler["handleCompressedVideo"] =
    jest.fn((messageEvent) => {
      this.emitState({ image: messageEvent as MessageEvent<AnyImage> }, undefined);
    });
}

class TestImageRenderable extends ImageRenderable {
  public readonly setImageCalls: AnyImage[] = [];
  public readonly setCompressedVideoFrameBatches: AnyImage[][] = [];
  public readonly setCompressedVideoFrameOptions: (SetCompressedVideoFramesOptions | undefined)[] =
    [];
  public resetForSeekCalls = 0;
  public disposed = false;

  public constructor(
    topicName: string,
    renderer: IRenderer,
    userData: ImageUserData,
    private readonly nextDisplayResult?: () => ImageSetImageResult | undefined,
  ) {
    super(topicName, renderer, userData);
  }

  public override async setImage(
    image: AnyImage,
    _resizeWidth?: number,
    _onDecoded?: () => void,
  ): Promise<ImageSetImageResult> {
    this.userData.image = image;
    this.setImageCalls.push(image);
    return { ok: true };
  }

  public override async setCompressedVideoFrames(
    frames: readonly CompressedVideoFrameEvent[],
    options?: SetCompressedVideoFramesOptions,
  ): Promise<ImageSetImageResult> {
    const targetFrame = frames[frames.length - 1];
    if (targetFrame == undefined) {
      return { ok: false, reason: "failed" };
    }

    this.userData.image = targetFrame.message;
    this.setCompressedVideoFrameBatches.push(frames.map((frame) => frame.message));
    this.setCompressedVideoFrameOptions.push(options);
    const configuredResult = this.nextDisplayResult?.();
    if (configuredResult != undefined) {
      return configuredResult;
    }
    options?.onDecoded?.();
    options?.updateImageState?.(targetFrame);
    return { ok: true };
  }

  public override resetForSeek(): void {
    this.resetForSeekCalls++;
  }

  public override dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}

let nextMessageHandler: IMessageHandler | undefined;

class TestImageMode extends ImageMode {
  public readonly createdRenderables: TestImageRenderable[] = [];
  public readonly displayResults: ImageSetImageResult[] = [];

  protected override initMessageHandler(config: Immutable<ConfigWithDefaults>): IMessageHandler {
    if (nextMessageHandler != undefined) {
      return nextMessageHandler;
    }
    return super.initMessageHandler(config);
  }

  protected override initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    const renderable = new TestImageRenderable(topicName, this.renderer, userData, () =>
      this.displayResults.shift(),
    );
    this.createdRenderables.push(renderable);
    return renderable;
  }

  public currentImageRenderable(): TestImageRenderable | undefined {
    return this.imageRenderable as TestImageRenderable | undefined;
  }
}

function makeRenderer(
  options: {
    topics?: { name: string; schemaName: string }[];
    imageTopic?: string;
    synchronize?: boolean;
  } = {},
): IRenderer {
  const emitter = new EventEmitter();
  const topics = options.topics ?? [{ name: "/camera", schemaName: "foxglove.CompressedVideo" }];
  const config = {
    cameraState: {},
    followTf: undefined,
    followMode: "follow-none",
    scene: {},
    publish: {},
    transforms: {},
    topics: {},
    layers: {},
    imageMode: {
      imageTopic: options.imageTopic ?? "/camera",
      synchronize: options.synchronize ?? false,
    },
  };

  return Object.assign(emitter, {
    config,
    topics,
    topicsByName: new Map(topics.map((topic) => [topic.name, topic])),
    currentTime: 100_000_000n,
    startTime: 0n,
    isPlaybackStopped: () => false,
    getPlaybackIsPlaying: () => true,
    subscribeMessageRange: undefined,
    input: {
      canvasSize: { width: 640, height: 480 },
      on: jest.fn(),
      trackDrag: jest.fn(),
    },
    settings: {
      errors: {
        add: jest.fn(),
        addToTopic: jest.fn(),
        clear: jest.fn(),
        clearPath: jest.fn(),
        errorIfFalse: jest.fn(),
        errors: {
          errorAtPath: jest.fn(),
        },
        off: jest.fn(),
        on: jest.fn(),
        remove: jest.fn(),
        removeFromTopic: jest.fn(),
      },
      setNodesForKey: jest.fn(),
    },
    hud: new HUDItemManager(jest.fn()),
    labelPool: {},
    getPixelRatio: jest.fn(() => 1),
    normalizeFrameId: jest.fn((frameId: string) => frameId),
    queueAnimationFrame: jest.fn(),
    setFollowFrameId: jest.fn(),
    updateConfig: jest.fn((updateHandler: (draft: typeof config) => void) => {
      updateHandler(config);
    }),
    enableImageOnlySubscriptionMode: jest.fn(),
    disableImageOnlySubscriptionMode: jest.fn(),
  }) as unknown as IRenderer;
}

function schemaSubscription(imageMode: ImageMode, schemaName: string) {
  const subscription = imageMode
    .getSubscriptions()
    .find((entry) => entry.type === "schema" && entry.schemaNames.has(schemaName))?.subscription;
  if (subscription == undefined) {
    throw new Error(`Missing ${schemaName} subscription`);
  }
  return subscription;
}

function compressedVideoSubscription(imageMode: ImageMode) {
  return schemaSubscription(imageMode, "foxglove.CompressedVideo");
}

function synchronizeSettingsField(imageMode: ImageMode) {
  const field = imageMode.settingsNodes()[0]?.node.fields?.synchronize;
  if (field?.input !== "boolean") {
    throw new Error("Missing synchronize settings field");
  }
  return field;
}

describe("ImageMode compressed video seek replay", () => {
  beforeEach(() => {
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "IsKeyframe").mockImplementation((data) => data[0] === 0x65);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
    nextMessageHandler = undefined;
    jest.restoreAllMocks();
  });

  it("restores legacy synchronize=true for compressed video topics", () => {
    const imageMode = new TestImageMode(makeRenderer({ synchronize: true }));

    expect(synchronizeSettingsField(imageMode)).toMatchObject({
      value: true,
    });
  });

  it("applies externally supplied synchronization config to the message handler", () => {
    const messageHandler = new FakeMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    new TestImageMode(renderer);

    renderer.config = {
      ...renderer.config,
      imageMode: { ...renderer.config.imageMode, synchronize: true },
    };
    renderer.emit("configChange", renderer);

    expect(messageHandler.setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ synchronize: true }),
    );
  });

  it("retains the displayed video when synchronization changes while paused", async () => {
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    subscription.processQueue?.([keyframe], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    const displayedRenderable = imageMode.currentImageRenderable();

    renderer.config = {
      ...renderer.config,
      imageMode: { ...renderer.config.imageMode, synchronize: true },
    };
    renderer.emit("configChange", renderer);

    expect(imageMode.currentImageRenderable()).toBe(displayedRenderable);
    expect(displayedRenderable?.disposed).toBe(false);
  });

  it("shows a warning when the selected video stream declares B-frames", async () => {
    jest.spyOn(H264, "HasBFrames").mockReturnValue(true);
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);

    compressedVideoSubscription(imageMode).processQueue?.(
      [makeVideoMessage(0n, "key")],
      PLAYBACK_CONTEXT,
    );

    expect(renderer.hud.getHUDItems()).toContainEqual(
      expect.objectContaining({ id: "VIDEO_B_FRAMES:/camera", displayType: "notice" }),
    );
  });

  it("switches compressed video state when the configured topic changes externally", async () => {
    const renderer = makeRenderer({
      topics: [
        { name: "/camera", schemaName: "foxglove.CompressedVideo" },
        { name: "/camera2", schemaName: "foxglove.CompressedVideo" },
      ],
    });
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const firstFrame = makeVideoMessage(0n, "key");
    subscription.processQueue?.([firstFrame], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    const previousRenderable = imageMode.currentImageRenderable();

    renderer.config = {
      ...renderer.config,
      imageMode: { ...renderer.config.imageMode, imageTopic: "/camera2" },
    };
    renderer.emit("configChange", renderer);

    expect(previousRenderable?.disposed).toBe(true);
    expect(imageMode.currentImageRenderable()).toBeUndefined();

    const nextFrame = { ...makeVideoMessage(10_000_000n, "key"), topic: "/camera2" };
    subscription.processQueue?.([nextFrame], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    expect(imageMode.currentImageRenderable()).not.toBe(previousRenderable);
    expect(imageMode.createdRenderables.at(-1)?.setCompressedVideoFrameBatches).toEqual([
      [nextFrame.message],
    ]);
  });

  it("keeps sync annotations available for non-video image topics", () => {
    const renderer = makeRenderer({
      topics: [{ name: "/camera", schemaName: "foxglove.RawImage" }],
      synchronize: true,
    });
    const imageMode = new TestImageMode(renderer);
    const subscription = schemaSubscription(imageMode, "foxglove.RawImage");
    const first = makeRawImageMessage(0n);
    const second = makeRawImageMessage(10_000_000n);

    expect(synchronizeSettingsField(imageMode)).toMatchObject({
      value: true,
    });
    expect(subscription.filterQueue?.([first, second])).toEqual([first, second]);
  });

  it("routes the full compressed video tick through processQueue", async () => {
    const imageMode = new TestImageMode(makeRenderer({ synchronize: true }));
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");

    expect(subscription.filterQueue).toBeUndefined();
    subscription.processQueue?.([keyframe, middle, target], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    expect(imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [keyframe.message, middle.message, target.message],
    ]);
  });

  it("renders seek GOP frames directly when the message handler does not emit an image", async () => {
    const messageHandler = new FakeMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(messageHandler.handleCompressedVideo).not.toHaveBeenCalled();
    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);

    renderer.currentTime = 10_000_000n;
    imageMode.handleSeek();
    subscription.processQueue?.([], SEEK_CONTEXT);
    await flushAsyncWork();

    expect(messageHandler.handleCompressedVideo).not.toHaveBeenCalled();
    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([
      [keyframe.message.timestamp, delta.message.timestamp],
      [keyframe.message.timestamp, delta.message.timestamp],
    ]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameOptions.map(
        (options) => options?.retainLateTarget,
      ),
    ).toEqual([false, true]);
    expect(imageMode.createdRenderables[0]!.setImageCalls).toEqual([]);
  });

  it("submits one ordered playback batch and records the displayed target state", async () => {
    const messageHandler = new FakeMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");

    subscription.processQueue?.([keyframe, middle, target], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, middle.message.timestamp, target.message.timestamp]]);
    expect(imageMode.createdRenderables[0]!.setImageCalls).toEqual([]);
    expect(messageHandler.handleCompressedVideo).not.toHaveBeenCalled();
    expect(messageHandler.updateImageState).toHaveBeenCalledTimes(1);
    expect(messageHandler.updateImageState).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: target.message }),
      target.message,
    );
  });

  it("does not render the seek GOP frame twice when updateImageState emits", async () => {
    const messageHandler = new EmittingUpdateImageStateMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    renderer.currentTime = 10_000_000n;
    imageMode.handleSeek();
    subscription.processQueue?.([], SEEK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([
      [keyframe.message.timestamp, delta.message.timestamp],
      [keyframe.message.timestamp, delta.message.timestamp],
    ]);
  });

  it("uses legacy synchronize=true with a complete current tick GOP", async () => {
    const messageHandler = new SynchronizingCompressedVideoMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer({ synchronize: true });
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    renderer.currentTime = 20_000_000n;
    messageHandler.target = delta;

    subscription.processQueue?.([keyframe, middle, delta], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, middle.message.timestamp, delta.message.timestamp]]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameOptions.map(
        (options) => options?.retainLateTarget,
      ),
    ).toEqual([false]);
    expect(messageHandler.handleCompressedVideo).not.toHaveBeenCalled();
    expect(messageHandler.recordCompressedVideo).toHaveBeenCalledTimes(3);
    expect(messageHandler.updateImageState).toHaveBeenCalledTimes(1);
  });

  it("invalidates the synchronized decoder when recorded timestamps regress", async () => {
    const messageHandler = new SynchronizingCompressedVideoMessageHandler();
    nextMessageHandler = messageHandler;
    const imageMode = new TestImageMode(makeRenderer({ synchronize: true }));
    const subscription = compressedVideoSubscription(imageMode);
    const first = makeVideoMessage(20_000_000n, "key");
    const next = makeVideoMessage(10_000_000n, "key");
    messageHandler.target = first;
    subscription.processQueue?.([first], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    jest.mocked(messageHandler.consumeTimestampRegression).mockReturnValueOnce(true);
    messageHandler.target = next;
    subscription.processQueue?.([next], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables[0]!.resetForSeekCalls).toBe(1);
    expect(imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [first.message],
      [next.message],
    ]);
  });

  it("decodes a replacement synchronized video target with the same publish timestamp", async () => {
    const messageHandler = new SynchronizingCompressedVideoMessageHandler();
    nextMessageHandler = messageHandler;
    const imageMode = new TestImageMode(makeRenderer({ synchronize: true }));
    const subscription = compressedVideoSubscription(imageMode);
    const first = makeVideoMessage(10_000_000n, "key");
    const replacement = {
      ...makeVideoMessage(10_000_000n, "delta"),
      receiveTime: { sec: 0, nsec: 20_000_000 },
    };

    messageHandler.target = first;
    subscription.processQueue?.([first], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    messageHandler.target = replacement;
    subscription.processQueue?.([replacement], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [first.message],
      [replacement.message],
    ]);
  });

  it("clears the waiting-for-image HUD after direct seek replay", async () => {
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);
    await flushAsyncWork();

    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);

    renderer.currentTime = 10_000_000n;
    imageMode.removeAllRenderables();
    // The previous image is retained on the canvas during the seek, so we show the non-blocking
    // notice rather than the full-panel empty state that would paint over it.
    expect(renderer.hud.getHUDItems()).toContainEqual(WAITING_FOR_IMAGE_NOTICE_HUD_ITEM);
    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);

    imageMode.handleSeek();
    subscription.processQueue?.([], SEEK_CONTEXT);
    await flushAsyncWork();

    expect(imageMode.createdRenderables[0]!.setImageCalls).toEqual([]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([
      [keyframe.message.timestamp, delta.message.timestamp],
      [keyframe.message.timestamp, delta.message.timestamp],
    ]);
    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);
  });

  it("looks back for the selected compressed video topic when seek backfill has no current frame", async () => {
    const renderer = makeRenderer();
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      return jest.fn();
    });
    renderer.subscribeMessageRange = subscribeMessageRange;
    renderer.currentTime = 10_000_000n;
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);

    imageMode.handleSeek();
    subscription.processQueue?.([], SEEK_CONTEXT);
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 10_000_000 },
        },
      }),
    );
    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);
  });

  it("keeps an in-flight seek lookback after delayed renderable cleanup", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    try {
      const renderer = makeRenderer();
      const keyframe = makeVideoMessage(0n, "key");
      const delta = makeVideoMessage(10_000_000n, "delta");
      let onNewRangeIterator:
        | Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"]
        | undefined;
      const subscribeMessageRange = jest.fn<
        ReturnType<SubscribeMessageRange>,
        Parameters<SubscribeMessageRange>
      >((args) => {
        onNewRangeIterator = args.onNewRangeIterator;
        return jest.fn();
      });
      renderer.subscribeMessageRange = subscribeMessageRange;
      renderer.currentTime = 10_000_000n;
      const imageMode = new TestImageMode(renderer);
      const subscription = compressedVideoSubscription(imageMode);

      imageMode.removeAllRenderables();
      imageMode.handleSeek();
      subscription.processQueue?.([], SEEK_CONTEXT);
      await flushAsyncWork();

      expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(51);

      await onNewRangeIterator?.(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      await flushAsyncWork();

      const displayedBatches = imageMode.createdRenderables.flatMap((renderable) =>
        renderable.setCompressedVideoFrameBatches.map((batch) => batch.map(timestampFromImage)),
      );
      expect(displayedBatches).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the previous image and shows a keyframe search notice during delayed seek lookback", async () => {
    const messageHandler = new PlaybackCompressedVideoMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const targetDelta = makeVideoMessage(20_000_000n, "delta");
    let onNewRangeIterator: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"] | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      onNewRangeIterator = args.onNewRangeIterator;
      return jest.fn();
    });

    subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);
    await flushAsyncWork();
    const previousRenderable = imageMode.currentImageRenderable();
    expect(previousRenderable).toBeDefined();

    renderer.subscribeMessageRange = subscribeMessageRange;
    renderer.currentTime = 20_000_000n;

    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    try {
      imageMode.removeAllRenderables();
      imageMode.handleSeek();
      subscription.processQueue?.([], SEEK_CONTEXT);
      await flushAsyncWork();

      jest.advanceTimersByTime(51);
      expect(imageMode.currentImageRenderable()).toBe(previousRenderable);
      expect(previousRenderable?.disposed).toBe(false);
      expect(renderer.hud.getHUDItems().map((item) => item.id)).toContain("SEEK_KEYFRAME_SEARCH");
      expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);
    } finally {
      jest.useRealTimers();
    }

    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, delta, targetDelta];
      })(),
    );
    // Recovery completes independently of the synchronous ingestion call.
    await flushAsyncWork();

    expect(
      imageMode
        .currentImageRenderable()
        ?.setCompressedVideoFrameBatches.map((batch) => batch.map(timestampFromImage)),
    ).toEqual([
      [keyframe.message.timestamp, delta.message.timestamp],
      [keyframe.message.timestamp, delta.message.timestamp, targetDelta.message.timestamp],
    ]);
    expect(renderer.hud.getHUDItems().map((item) => item.id)).not.toContain("SEEK_KEYFRAME_SEARCH");
  });

  it("does not look back for a selected non-video image topic", async () => {
    const renderer = makeRenderer({
      topics: [{ name: "/camera", schemaName: "foxglove.RawImage" }],
    });
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    renderer.subscribeMessageRange = subscribeMessageRange;
    renderer.currentTime = 10_000_000n;
    const imageMode = new TestImageMode(renderer);

    imageMode.handleSeek();

    expect(subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("keeps an in-flight seek lookback when topics change without changing the selected image topic", async () => {
    const renderer = makeRenderer();
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const unsubscribe = jest.fn();
    let onNewRangeIterator: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"] | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      onNewRangeIterator = args.onNewRangeIterator;
      return unsubscribe;
    });
    renderer.subscribeMessageRange = subscribeMessageRange;
    renderer.currentTime = 10_000_000n;
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);

    imageMode.handleSeek();
    subscription.processQueue?.([], SEEK_CONTEXT);
    await Promise.resolve();

    (renderer as unknown as EventEmitter).emit("topicsChanged");
    await flushAsyncWork();

    expect(unsubscribe).not.toHaveBeenCalled();
    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, delta];
      })(),
    );
    // Recovery completes independently of the synchronous ingestion call.
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
  });
});
