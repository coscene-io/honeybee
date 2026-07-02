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
import { IRenderer } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
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

function timestampFromImage(image: AnyImage): Time {
  return "header" in image ? image.header.stamp : image.timestamp;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

class FakeMessageHandler implements IMessageHandler {
  public readonly handleRosRawImage: IMessageHandler["handleRosRawImage"] = jest.fn();
  public readonly handleRosCompressedImage: IMessageHandler["handleRosCompressedImage"] = jest.fn();
  public readonly handleRawImage: IMessageHandler["handleRawImage"] = jest.fn();
  public readonly handleCompressedImage: IMessageHandler["handleCompressedImage"] = jest.fn();
  public readonly handleCompressedVideo: IMessageHandler["handleCompressedVideo"] = jest.fn();
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
  public target: MessageEvent<CompressedVideo> | undefined;

  public override readonly handleCompressedVideo: IMessageHandler["handleCompressedVideo"] =
    jest.fn((messageEvent) => {
      const timestamp = messageEvent.message.timestamp;
      if (
        this.target != undefined &&
        timestamp?.sec != undefined &&
        timestamp.nsec != undefined &&
        toNanoSec(this.target.message.timestamp) === toNanoSec(timestamp as Time)
      ) {
        this.emitState({ image: this.target }, undefined);
      }
    });
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
      return { ok: false };
    }

    this.userData.image = targetFrame.message;
    this.setCompressedVideoFrameBatches.push(frames.map((frame) => frame.message));
    this.setCompressedVideoFrameOptions.push(options);
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

  protected override initMessageHandler(config: Immutable<ConfigWithDefaults>): IMessageHandler {
    if (nextMessageHandler != undefined) {
      return nextMessageHandler;
    }
    return super.initMessageHandler(config);
  }

  protected override initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    const renderable = new TestImageRenderable(topicName, this.renderer, userData);
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
    currentTime: 0n,
    startTime: 0n,
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

function compressedVideoSubscription(imageMode: ImageMode) {
  const subscription = imageMode
    .getSubscriptions()
    .find(
      (entry) => entry.type === "schema" && entry.schemaNames.has("foxglove.CompressedVideo"),
    )?.subscription;
  if (subscription == undefined) {
    throw new Error("Missing compressed video subscription");
  }
  return subscription;
}

describe("ImageMode compressed video seek replay", () => {
  beforeEach(() => {
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
    nextMessageHandler = undefined;
    jest.restoreAllMocks();
  });

  it("renders seek GOP frames directly when the message handler does not emit an image", async () => {
    const messageHandler = new FakeMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.handler(keyframe);
    subscription.handler(delta);
    await flushAsyncWork();

    expect(messageHandler.handleCompressedVideo).toHaveBeenCalledTimes(1);
    expect(imageMode.createdRenderables).toHaveLength(0);

    renderer.currentTime = 10_000_000n;
    imageMode.handleSeek();
    await flushAsyncWork();

    expect(messageHandler.handleCompressedVideo).toHaveBeenCalledTimes(1);
    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameOptions.map(
        (options) => options?.allowIntermediateVideoFrame,
      ),
    ).toEqual([false]);
    expect(imageMode.createdRenderables[0]!.setImageCalls).toEqual([]);
  });

  it("does not render the seek GOP frame twice when updateImageState emits", async () => {
    const messageHandler = new EmittingUpdateImageStateMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.handler(keyframe);
    subscription.handler(delta);

    renderer.currentTime = 10_000_000n;
    imageMode.handleSeek();
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
  });

  it("replays cached GOP frames when synchronized mode emits a compressed video delta", async () => {
    const messageHandler = new SynchronizingCompressedVideoMessageHandler();
    nextMessageHandler = messageHandler;
    const renderer = makeRenderer({ synchronize: true });
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    messageHandler.target = delta;

    subscription.handler(keyframe);
    subscription.handler(middle);
    subscription.handler(delta);
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, middle.message.timestamp, delta.message.timestamp]]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameOptions.map(
        (options) => options?.allowIntermediateVideoFrame,
      ),
    ).toEqual([false]);
    expect(messageHandler.updateImageState).not.toHaveBeenCalled();
  });

  it("clears the waiting-for-image HUD after direct seek replay", async () => {
    const renderer = makeRenderer();
    const imageMode = new TestImageMode(renderer);
    const subscription = compressedVideoSubscription(imageMode);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.handler(keyframe);
    subscription.handler(delta);
    await flushAsyncWork();

    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);

    renderer.currentTime = 10_000_000n;
    imageMode.removeAllRenderables();
    // The previous image is retained on the canvas during the seek, so we show the non-blocking
    // notice rather than the full-panel empty state that would paint over it.
    expect(renderer.hud.getHUDItems()).toContainEqual(WAITING_FOR_IMAGE_NOTICE_HUD_ITEM);
    expect(renderer.hud.getHUDItems()).not.toContainEqual(WAITING_FOR_IMAGE_EMPTY_HUD_ITEM);

    imageMode.handleSeek();
    await flushAsyncWork();

    expect(imageMode.createdRenderables[0]!.setImageCalls.map(timestampFromImage)).toEqual([
      delta.message.timestamp,
    ]);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
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

    imageMode.handleSeek();
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
    jest.useFakeTimers();
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

      imageMode.removeAllRenderables();
      imageMode.handleSeek();

      expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(51);

      await onNewRangeIterator?.(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      await Promise.resolve();
      await Promise.resolve();

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

    subscription.handler(keyframe);
    subscription.handler(delta);
    await flushAsyncWork();
    const previousRenderable = imageMode.currentImageRenderable();
    expect(previousRenderable).toBeDefined();

    renderer.subscribeMessageRange = subscribeMessageRange;
    renderer.currentTime = 20_000_000n;

    jest.useFakeTimers();
    try {
      imageMode.removeAllRenderables();
      imageMode.handleSeek();

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
    await flushAsyncWork();

    expect(
      imageMode
        .currentImageRenderable()
        ?.setCompressedVideoFrameBatches.map((batch) => batch.map(timestampFromImage)),
    ).toEqual([
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
    await flushAsyncWork();

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

    imageMode.handleSeek();
    await flushAsyncWork();

    (renderer as unknown as EventEmitter).emit("topicsChanged");
    await flushAsyncWork();

    expect(unsubscribe).not.toHaveBeenCalled();
    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, delta];
      })(),
    );
    await flushAsyncWork();

    expect(imageMode.createdRenderables).toHaveLength(1);
    expect(
      imageMode.createdRenderables[0]!.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toEqual([[keyframe.message.timestamp, delta.message.timestamp]]);
  });
});
