/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";

import { H264 } from "@foxglove/den/video";
import { Time } from "@foxglove/rostime";
import { MessageEvent, SettingsTreeAction } from "@foxglove/studio";
import { HUDItemManager } from "@foxglove/studio-base/panels/ThreeDeeRender/HUDItemManager";
import { IRenderer, RendererConfig } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { Images, LayerSettingsImage } from "./Images";
import {
  type CompressedVideoFrameEvent,
  ImageRenderable,
  ImageSetImageResult,
  ImageUserData,
  type SetCompressedVideoFramesOptions,
} from "./Images/ImageRenderable";
import { AnyImage, CompressedVideo } from "./Images/ImageTypes";
import { globalVideoSeekLookbackGate } from "./Images/videoSeekLookbackGate";

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeVideoMessage(
  timestamp: bigint,
  type: "key" | "delta",
  topic: string = "/video",
): MessageEvent<CompressedVideo> {
  return {
    topic,
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

class TestImageRenderable extends ImageRenderable {
  public readonly setImageCalls: AnyImage[] = [];
  public readonly setCompressedVideoFrameBatches: AnyImage[][] = [];
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
      return { ok: false, reason: "failed" };
    }
    this.userData.image = targetFrame.message;
    this.setCompressedVideoFrameBatches.push(frames.map((frame) => frame.message));
    options?.onDecoded?.();
    options?.updateImageState?.(targetFrame);
    return { ok: true };
  }

  public override dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}

class TestImages extends Images {
  public readonly createdRenderables: TestImageRenderable[] = [];

  protected override initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    const renderable = new TestImageRenderable(topicName, this.renderer, userData);
    this.createdRenderables.push(renderable);
    return renderable;
  }
}

function makeRenderer(
  options: {
    topicSettings?: Record<string, Partial<LayerSettingsImage> | undefined>;
    subscribeMessageRange?: SubscribeMessageRange;
    videoTopics?: string[];
  } = {},
): IRenderer {
  const emitter = new EventEmitter();
  const videoTopics = options.videoTopics ?? ["/video"];
  const topics = [
    ...videoTopics.map((name) => ({ name, schemaName: "foxglove.CompressedVideo" })),
    { name: "/raw", schemaName: "foxglove.RawImage" },
  ];
  const config: RendererConfig = {
    cameraState: {},
    followTf: undefined,
    followMode: "follow-none",
    scene: {},
    publish: {},
    transforms: {},
    topics: options.topicSettings ?? {
      ...Object.fromEntries(videoTopics.map((name) => [name, { visible: true }])),
      "/raw": { visible: true },
    },
    layers: {},
    imageMode: {},
  } as RendererConfig;

  return Object.assign(emitter, {
    config,
    topics,
    topicsByName: new Map(topics.map((topic) => [topic.name, topic])),
    currentTime: 10_000_000n,
    startTime: 0n,
    subscribeMessageRange: options.subscribeMessageRange,
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
    normalizeFrameId: jest.fn((frameId: string) => frameId),
    queueAnimationFrame: jest.fn(),
    updateConfig: jest.fn((updateHandler: (draft: RendererConfig) => void) => {
      updateHandler(config);
    }),
  }) as unknown as IRenderer;
}

describe("Images compressed video seek lookback", () => {
  beforeEach(() => {
    globalVideoSeekLookbackGate.resetForTests();
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
    globalVideoSeekLookbackGate.resetForTests();
    jest.restoreAllMocks();
  });

  function compressedVideoSubscription(images: Images) {
    const subscription = images
      .getSubscriptions()
      .find(
        (entry) => entry.type === "schema" && entry.schemaNames.has("foxglove.CompressedVideo"),
      )?.subscription;
    if (subscription == undefined) {
      throw new Error("Missing compressed video subscription");
    }
    return subscription;
  }

  it("looks back for visible compressed video topics before any frame is received", () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    const renderer = makeRenderer({ subscribeMessageRange });
    const images = new TestImages(renderer);

    images.handleSeek();

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/video",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 10_000_000 },
        },
      }),
    );
  });

  it("does not look back for raw image topics or hidden compressed video topics", () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    const renderer = makeRenderer({
      topicSettings: {
        "/video": { visible: false },
        "/raw": { visible: true },
      },
      subscribeMessageRange,
    });
    const images = new TestImages(renderer);

    images.handleSeek();

    expect(subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("registers a compressed video topic when it becomes visible from settings", () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    const renderer = makeRenderer({
      topicSettings: {
        "/video": { visible: false },
        "/raw": { visible: true },
      },
      subscribeMessageRange,
    });
    const images = new TestImages(renderer);

    images.handleSeek();

    const action: SettingsTreeAction = {
      action: "update",
      payload: {
        path: ["topics", "/video", "visible"],
        input: "boolean",
        value: true,
      },
    };
    images.handleSettingsAction(action);
    images.handleSeek();

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/video",
      }),
    );
  });

  it("replays cached compressed video GOP after renderables are removed", async () => {
    const renderer = makeRenderer({ subscribeMessageRange: undefined });
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");

    subscription.handler(keyframe);
    subscription.handler(delta);
    await flushAsyncWork();

    images.removeAllRenderables();
    images.handleSeek();
    await Promise.resolve();
    await Promise.resolve();

    const displayedBatches = images.createdRenderables.flatMap((renderable) =>
      renderable.setCompressedVideoFrameBatches.map((batch) => batch.map(timestampFromImage)),
    );
    expect(displayedBatches).toEqual([
      [keyframe.message.timestamp],
      [delta.message.timestamp],
      [keyframe.message.timestamp, delta.message.timestamp],
    ]);
  });

  it("keeps visible compressed video renderables and shows keyframe search notice during seek lookback", async () => {
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
    const renderer = makeRenderer({ subscribeMessageRange });
    renderer.currentTime = 0n;
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);

    subscription.handler(keyframe);
    subscription.handler(delta);
    await flushAsyncWork();

    const previousRenderable = images.renderables.get("/video") as TestImageRenderable | undefined;
    expect(previousRenderable).toBeDefined();

    (
      images as unknown as {
        removeAllRenderables(args?: { reason?: "seek" }): void;
      }
    ).removeAllRenderables({ reason: "seek" });
    renderer.currentTime = 20_000_000n;
    images.handleSeek();

    expect(images.renderables.get("/video")).toBe(previousRenderable);
    expect(previousRenderable?.disposed).toBe(false);
    expect(renderer.hud.getHUDItems().map((item) => item.id)).toContain("SEEK_KEYFRAME_SEARCH");

    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, delta, targetDelta];
      })(),
    );
    // Range-read gate finally + displayFrames continue after the iterator settles.
    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      previousRenderable?.setCompressedVideoFrameBatches.map((batch) =>
        batch.map(timestampFromImage),
      ),
    ).toContainEqual([
      keyframe.message.timestamp,
      delta.message.timestamp,
      targetDelta.message.timestamp,
    ]);
    expect(renderer.hud.getHUDItems().map((item) => item.id)).not.toContain("SEEK_KEYFRAME_SEARCH");
  });
});

describe("Images compressed video seek lookback gate contention", () => {
  // Five cameras — the Astribot S1 layout shape. Unlike the gate unit tests, real keyframe/delta
  // frames flow through the gated range reads here, so queueing and stale-waiter dropping are
  // exercised together with GOP recovery and display, not in isolation.
  const VIDEO_TOPICS = ["/video0", "/video1", "/video2", "/video3", "/video4"];

  type CapturedRead = {
    topic: string;
    timeRange: { start: Time; end: Time };
    onNewRangeIterator: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"];
    unsubscribe: jest.Mock;
    resolved: boolean;
  };

  beforeEach(() => {
    globalVideoSeekLookbackGate.resetForTests();
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
    globalVideoSeekLookbackGate.resetForTests();
    jest.restoreAllMocks();
  });

  function makeContendedSetup() {
    const reads: CapturedRead[] = [];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      const unsubscribe = jest.fn();
      reads.push({
        topic: args.topic,
        timeRange: args.timeRange,
        onNewRangeIterator: args.onNewRangeIterator,
        unsubscribe,
        resolved: false,
      });
      return unsubscribe;
    });
    const renderer = makeRenderer({ videoTopics: VIDEO_TOPICS, subscribeMessageRange });
    renderer.currentTime = 0n;
    const images = new TestImages(renderer);
    const subscription = images
      .getSubscriptions()
      .find(
        (entry) => entry.type === "schema" && entry.schemaNames.has("foxglove.CompressedVideo"),
      )?.subscription;
    if (subscription == undefined) {
      throw new Error("Missing compressed video subscription");
    }
    return { reads, renderer, images, subscription };
  }

  async function resolveRead(read: CapturedRead, frames: MessageEvent<CompressedVideo>[]) {
    read.resolved = true;
    await read.onNewRangeIterator(
      (async function* () {
        yield frames;
      })(),
    );
    await flushAsyncWork();
  }

  function displayedSeekBatches(images: TestImages, topic: string): Time[][] {
    const renderable = images.renderables.get(topic) as TestImageRenderable | undefined;
    return (renderable?.setCompressedVideoFrameBatches ?? []).map((batch) =>
      batch.map(timestampFromImage),
    );
  }

  it("recovers GOPs on five cameras while at most two range reads run concurrently", async () => {
    const { reads, renderer, images, subscription } = makeContendedSetup();

    for (const topic of VIDEO_TOPICS) {
      subscription.handler(makeVideoMessage(0n, "key", topic));
      subscription.handler(makeVideoMessage(10_000_000n, "delta", topic));
    }
    await flushAsyncWork();

    (
      images as unknown as { removeAllRenderables(args?: { reason?: "seek" }): void }
    ).removeAllRenderables({ reason: "seek" });
    renderer.currentTime = 20_000_000n;
    images.handleSeek();

    // All five cameras want a lookback read, but only two slots exist.
    expect(reads).toHaveLength(2);
    expect(reads.map((read) => read.topic)).toEqual(["/video0", "/video1"]);
    expect(globalVideoSeekLookbackGate.getActiveCount()).toBe(2);
    expect(globalVideoSeekLookbackGate.getPendingCount()).toBe(3);

    // Each resolved read frees its slot for exactly one queued camera.
    for (const expectedCount of [3, 4, 5, 5, 5]) {
      const nextUnresolved = reads.find((read) => !read.resolved);
      expect(nextUnresolved).toBeDefined();
      const topic = nextUnresolved!.topic;
      await resolveRead(nextUnresolved!, [
        makeVideoMessage(0n, "key", topic),
        makeVideoMessage(10_000_000n, "delta", topic),
        makeVideoMessage(20_000_000n, "delta", topic),
      ]);
      expect(reads.length).toBe(expectedCount);
      expect(globalVideoSeekLookbackGate.getActiveCount()).toBeLessThanOrEqual(2);
    }

    // Every camera issued exactly one read and displayed its recovered GOP up to the target.
    expect(reads.map((read) => read.topic).sort()).toEqual([...VIDEO_TOPICS].sort());
    for (const topic of VIDEO_TOPICS) {
      expect(displayedSeekBatches(images, topic)).toContainEqual([
        timeFromNanoseconds(0n),
        timeFromNanoseconds(10_000_000n),
        timeFromNanoseconds(20_000_000n),
      ]);
    }
    expect(globalVideoSeekLookbackGate.getActiveCount()).toBe(0);
    expect(globalVideoSeekLookbackGate.getPendingCount()).toBe(0);
  });

  it("drops queued waiters superseded by a newer seek and completes the new seek with frames", async () => {
    const { reads, renderer, images, subscription } = makeContendedSetup();

    for (const topic of VIDEO_TOPICS) {
      subscription.handler(makeVideoMessage(0n, "key", topic));
      subscription.handler(makeVideoMessage(10_000_000n, "delta", topic));
    }
    await flushAsyncWork();

    (
      images as unknown as { removeAllRenderables(args?: { reason?: "seek" }): void }
    ).removeAllRenderables({ reason: "seek" });
    renderer.currentTime = 20_000_000n;
    images.handleSeek();

    expect(reads).toHaveLength(2);
    expect(globalVideoSeekLookbackGate.getPendingCount()).toBe(3);

    // A newer seek supersedes everything: the two in-flight reads are cancelled and the three
    // queued waiters must be dropped without ever issuing their stale reads.
    renderer.currentTime = 40_000_000n;
    images.handleSeek();
    await flushAsyncWork();

    // 2 cancelled reads from the first seek + 2 new reads now holding the slots. The three stale
    // waiters produced no reads.
    expect(reads).toHaveLength(4);
    expect(reads[0]!.unsubscribe).toHaveBeenCalled();
    expect(reads[1]!.unsubscribe).toHaveBeenCalled();
    const newReads = reads.slice(2);
    expect(newReads.map((read) => read.topic)).toEqual(["/video0", "/video1"]);
    for (const read of newReads) {
      expect(read.timeRange.end).toEqual(timeFromNanoseconds(40_000_000n));
    }
    expect(globalVideoSeekLookbackGate.getActiveCount()).toBe(2);
    expect(globalVideoSeekLookbackGate.getPendingCount()).toBe(3);

    // The new seek settles: every camera reads once for the new target and displays its GOP.
    reads[0]!.resolved = true;
    reads[1]!.resolved = true;
    for (;;) {
      const nextUnresolved = reads.find((read) => !read.resolved);
      if (nextUnresolved == undefined) {
        break;
      }
      const topic = nextUnresolved.topic;
      await resolveRead(nextUnresolved, [
        makeVideoMessage(0n, "key", topic),
        makeVideoMessage(10_000_000n, "delta", topic),
        makeVideoMessage(40_000_000n, "delta", topic),
      ]);
    }

    expect(reads).toHaveLength(7);
    expect(
      reads
        .slice(2)
        .map((read) => read.topic)
        .sort(),
    ).toEqual([...VIDEO_TOPICS].sort());
    for (const topic of VIDEO_TOPICS) {
      expect(displayedSeekBatches(images, topic)).toContainEqual([
        timeFromNanoseconds(0n),
        timeFromNanoseconds(10_000_000n),
        timeFromNanoseconds(40_000_000n),
      ]);
    }
    expect(globalVideoSeekLookbackGate.getActiveCount()).toBe(0);
    expect(globalVideoSeekLookbackGate.getPendingCount()).toBe(0);
  });
});
