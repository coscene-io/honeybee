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
import {
  IRenderer,
  RendererConfig,
  type RendererSubscriptionContext,
} from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
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

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeVideoMessage(
  timestamp: bigint,
  type: "key" | "delta",
  topic = "/video",
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

const PLAYBACK_CONTEXT: RendererSubscriptionContext = {
  didSeek: false,
  syncResult: undefined,
  syncTimestampChanged: false,
};

const SEEK_CONTEXT: RendererSubscriptionContext = {
  ...PLAYBACK_CONTEXT,
  didSeek: true,
};

class TestImageRenderable extends ImageRenderable {
  public readonly setImageCalls: AnyImage[] = [];
  public readonly setCompressedVideoFrameBatches: AnyImage[][] = [];
  public resetForSeekCalls = 0;
  public disposed = false;

  public constructor(
    topicName: string,
    renderer: IRenderer,
    userData: ImageUserData,
    private readonly beforeDisplay?: (topic: string) => Promise<void>,
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
    await this.beforeDisplay?.(this.userData.topic);
    const targetFrame = frames[frames.length - 1];
    if (targetFrame == undefined) {
      return { ok: false, reason: "failed" };
    }
    this.userData.image = targetFrame.message;
    this.setCompressedVideoFrameBatches.push(frames.map((frame) => frame.message));
    const configuredResult = this.nextDisplayResult?.();
    if (configuredResult != undefined) {
      return configuredResult;
    }
    options?.onDecoded?.();
    options?.updateImageState?.(targetFrame);
    return { ok: true };
  }

  public override dispose(): void {
    this.disposed = true;
    super.dispose();
  }

  public override resetForSeek(): void {
    this.resetForSeekCalls++;
  }
}

class TestImages extends Images {
  public readonly createdRenderables: TestImageRenderable[] = [];
  public beforeDisplay: ((topic: string) => Promise<void>) | undefined;
  public displayResults: ImageSetImageResult[] = [];

  protected override initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    const renderable = new TestImageRenderable(
      topicName,
      this.renderer,
      userData,
      async (topic) => await this.beforeDisplay?.(topic),
      () => this.displayResults.shift(),
    );
    this.createdRenderables.push(renderable);
    return renderable;
  }
}

function makeRenderer(
  options: {
    topicSettings?: Record<string, Partial<LayerSettingsImage> | undefined>;
    subscribeMessageRange?: SubscribeMessageRange;
    topics?: { name: string; schemaName: string }[];
    synchronize?: boolean;
    syncedTopics?: Record<string, boolean | undefined>;
  } = {},
): IRenderer {
  const emitter = new EventEmitter();
  const topics = options.topics ?? [
    { name: "/video", schemaName: "foxglove.CompressedVideo" },
    { name: "/raw", schemaName: "foxglove.RawImage" },
  ];
  const config: RendererConfig = {
    cameraState: {},
    followTf: undefined,
    followMode: "follow-none",
    scene: {},
    publish: {},
    transforms: {},
    topics:
      options.topicSettings ??
      Object.fromEntries(topics.map((topic) => [topic.name, { visible: true }])),
    layers: {},
    synchronize: options.synchronize,
    syncedTopics: options.syncedTopics,
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
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
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

  it("looks back for visible compressed video topics from the seek tick queue", async () => {
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    const renderer = makeRenderer({ subscribeMessageRange });
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);

    images.handleSeek();
    void subscription.processQueue?.([], SEEK_CONTEXT);
    await Promise.resolve();

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

  it("does not look back for raw image topics or hidden compressed video topics", async () => {
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
    const subscription = compressedVideoSubscription(images);

    images.handleSeek();
    await subscription.processQueue?.([], SEEK_CONTEXT);

    expect(subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("registers a compressed video topic when it becomes visible from settings", async () => {
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
    const subscription = compressedVideoSubscription(images);

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
    void subscription.processQueue?.([], SEEK_CONTEXT);
    await Promise.resolve();

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

    await subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);

    images.removeAllRenderables();
    images.handleSeek();
    await subscription.processQueue?.([], SEEK_CONTEXT);

    const displayedBatches = images.createdRenderables.flatMap((renderable) =>
      renderable.setCompressedVideoFrameBatches.map((batch) => batch.map(timestampFromImage)),
    );
    expect(displayedBatches).toEqual([
      [keyframe.message.timestamp, delta.message.timestamp],
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

    await subscription.processQueue?.([keyframe, delta], PLAYBACK_CONTEXT);

    const previousRenderable = images.renderables.get("/video") as TestImageRenderable | undefined;
    expect(previousRenderable).toBeDefined();

    (
      images as unknown as {
        removeAllRenderables(args?: { reason?: "seek" }): void;
      }
    ).removeAllRenderables({ reason: "seek" });
    renderer.currentTime = 20_000_000n;
    images.handleSeek();
    const seekWork = subscription.processQueue?.([], SEEK_CONTEXT);

    expect(images.renderables.get("/video")).toBe(previousRenderable);
    expect(previousRenderable?.disposed).toBe(false);
    expect(renderer.hud.getHUDItems().map((item) => item.id)).toContain("SEEK_KEYFRAME_SEARCH");

    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, delta, targetDelta];
      })(),
    );
    await seekWork;

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

  it("keeps ordinary image subscriptions last-only", () => {
    const images = new TestImages(makeRenderer());
    const subscription = images
      .getSubscriptions()
      .find(
        (entry) => entry.type === "schema" && entry.schemaNames.has("foxglove.RawImage"),
      )?.subscription;
    const first = { ...makeVideoMessage(0n, "key"), topic: "/raw" };
    const second = { ...makeVideoMessage(1n, "delta"), topic: "/raw" };

    expect(subscription?.filterQueue?.([first, second])).toEqual([second]);
  });

  it("decodes one full newest GOP batch for a compressed video tick", async () => {
    const images = new TestImages(makeRenderer());
    const subscription = compressedVideoSubscription(images);
    const oldKey = makeVideoMessage(0n, "key");
    const oldDelta = makeVideoMessage(10n, "delta");
    const newestKey = makeVideoMessage(20n, "key");
    const newestDelta = makeVideoMessage(30n, "delta");

    await subscription.processQueue?.([oldKey, oldDelta, newestKey, newestDelta], PLAYBACK_CONTEXT);

    expect(images.createdRenderables).toHaveLength(1);
    expect(images.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [newestKey.message, newestDelta.message],
    ]);
  });

  it("does not submit delta-only video before a decoder has a continuous GOP", async () => {
    const images = new TestImages(makeRenderer());
    const subscription = compressedVideoSubscription(images);

    await subscription.processQueue?.([makeVideoMessage(10n, "delta")], PLAYBACK_CONTEXT);

    expect(images.createdRenderables).toHaveLength(0);
  });

  it("processes five video topics in parallel with one ordered batch per topic", async () => {
    const topics = Array.from({ length: 5 }, (_value, index) => ({
      name: `/video-${index}`,
      schemaName: "foxglove.CompressedVideo",
    }));
    const images = new TestImages(makeRenderer({ topics }));
    const subscription = compressedVideoSubscription(images);
    const started = new Set<string>();
    let releaseAll!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    images.beforeDisplay = async (topic) => {
      started.add(topic);
      if (started.size === topics.length) {
        releaseAll();
      }
      await allStarted;
    };
    const queue = topics.flatMap(({ name }, index) => [
      makeVideoMessage(BigInt(index * 10), "key", name),
      makeVideoMessage(BigInt(index * 10 + 1), "delta", name),
    ]);

    await subscription.processQueue?.(queue, PLAYBACK_CONTEXT);

    expect(started).toEqual(new Set(topics.map((topic) => topic.name)));
    expect(images.createdRenderables).toHaveLength(5);
    for (const renderable of images.createdRenderables) {
      expect(renderable.setCompressedVideoFrameBatches).toHaveLength(1);
      expect(renderable.setCompressedVideoFrameBatches[0]).toHaveLength(2);
    }
  });

  it("finishes pending multi-topic seeks when the exact set completes on a later tick", async () => {
    const topics = [
      { name: "/left", schemaName: "foxglove.CompressedVideo" },
      { name: "/right", schemaName: "foxglove.CompressedVideo" },
    ];
    const leftKey = makeVideoMessage(0n, "key", "/left");
    const leftTarget = makeVideoMessage(20_000_000n, "delta", "/left");
    const rightKey = makeVideoMessage(0n, "key", "/right");
    const rightTarget = makeVideoMessage(20_000_000n, "delta", "/right");
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ topic, onNewRangeIterator }) => {
      const frames = topic === "/left" ? [leftKey, leftTarget] : [rightKey, rightTarget];
      void onNewRangeIterator(
        (async function* () {
          yield frames;
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({
      topics,
      synchronize: true,
      syncedTopics: { "/left": true, "/right": true },
      subscribeMessageRange,
    });
    renderer.currentTime = 20_000_000n;
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);

    images.handleSeek();
    await subscription.processQueue?.([leftTarget], {
      ...SEEK_CONTEXT,
      syncResult: {
        found: false,
        presentTopics: ["/left"],
        missingTopics: ["/right"],
      },
    });
    expect(subscribeMessageRange).not.toHaveBeenCalled();
    expect(images.createdRenderables).toHaveLength(0);

    await subscription.processQueue?.([], {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: leftTarget.message.timestamp,
        messages: new Map([
          ["/left", leftTarget],
          ["/right", rightTarget],
        ]),
      },
      syncTimestampChanged: true,
    });

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(
      images.createdRenderables
        .map((renderable) => ({
          topic: renderable.userData.topic,
          batches: renderable.setCompressedVideoFrameBatches.map((batch) =>
            batch.map(timestampFromImage),
          ),
        }))
        .sort((left, right) => left.topic.localeCompare(right.topic)),
    ).toEqual([
      {
        topic: "/left",
        batches: [[leftKey.message.timestamp, leftTarget.message.timestamp]],
      },
      {
        topic: "/right",
        batches: [[rightKey.message.timestamp, rightTarget.message.timestamp]],
      },
    ]);
  });

  it("shows the latest complete synchronized set while a newer timestamp is incomplete", async () => {
    const topics = [
      { name: "/left", schemaName: "foxglove.CompressedVideo" },
      { name: "/right", schemaName: "foxglove.CompressedVideo" },
    ];
    const renderer = makeRenderer({
      topics,
      synchronize: true,
      syncedTopics: { "/left": true, "/right": true },
    });
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);
    const left = makeVideoMessage(10n, "key", "/left");
    const right = makeVideoMessage(10n, "key", "/right");

    await subscription.processQueue?.([left, right], {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: left.message.timestamp,
        messages: new Map([
          [left.topic, left],
          [right.topic, right],
        ]),
        waiting: {
          timestamp: timeFromNanoseconds(20n),
          presentTopics: ["/left"],
          missingTopics: ["/right"],
        },
      },
      syncTimestampChanged: true,
    });

    expect(
      images.createdRenderables
        .map((renderable) => ({
          topic: renderable.userData.topic,
          batches: renderable.setCompressedVideoFrameBatches.map((batch) =>
            batch.map(timestampFromImage),
          ),
        }))
        .sort((leftEntry, rightEntry) => leftEntry.topic.localeCompare(rightEntry.topic)),
    ).toEqual([
      { topic: "/left", batches: [[timeFromNanoseconds(10n)]] },
      { topic: "/right", batches: [[timeFromNanoseconds(10n)]] },
    ]);
    expect(renderer.hud.getHUDItems().map((item) => item.id)).toContain(
      "VIDEO_SYNC_WAITING:/right",
    );
  });

  it("decodes a replacement target with the same synchronized publish timestamp", async () => {
    const renderer = makeRenderer({
      synchronize: true,
      syncedTopics: { "/video": true },
    });
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);
    const first = makeVideoMessage(10n, "key");
    const replacement = {
      ...makeVideoMessage(10n, "delta"),
      receiveTime: timeFromNanoseconds(20n),
    };

    await subscription.processQueue?.([first], {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: first.message.timestamp,
        messages: new Map([[first.topic, first]]),
      },
    });
    await subscription.processQueue?.([replacement], {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: replacement.message.timestamp,
        messages: new Map([[replacement.topic, replacement]]),
      },
    });

    expect(images.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [first.message],
      [first.message, replacement.message],
    ]);
  });

  it("invalidates synchronized topic decoders after a publish timestamp regression", async () => {
    const topics = [
      { name: "/left", schemaName: "foxglove.CompressedVideo" },
      { name: "/right", schemaName: "foxglove.CompressedVideo" },
    ];
    const renderer = makeRenderer({
      topics,
      synchronize: true,
      syncedTopics: { "/left": true, "/right": true },
    });
    const images = new TestImages(renderer);
    const subscription = compressedVideoSubscription(images);
    const highLeft = makeVideoMessage(100n, "key", "/left");
    const highRight = makeVideoMessage(100n, "key", "/right");
    await subscription.processQueue?.([highLeft, highRight], {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: highLeft.message.timestamp,
        messages: new Map([
          [highLeft.topic, highLeft],
          [highRight.topic, highRight],
        ]),
      },
    });

    const lowLeft = makeVideoMessage(1n, "key", "/left");
    const lowRight = makeVideoMessage(1n, "key", "/right");
    await subscription.processQueue?.([lowLeft, lowRight], {
      ...PLAYBACK_CONTEXT,
      syncTimestampRegressed: true,
      syncResult: {
        found: true,
        timestamp: lowLeft.message.timestamp,
        messages: new Map([
          [lowLeft.topic, lowLeft],
          [lowRight.topic, lowRight],
        ]),
      },
    });

    expect(images.createdRenderables.map((renderable) => renderable.resetForSeekCalls)).toEqual([
      1, 1,
    ]);
  });

  it("retries a synchronized target after a terminal decoder failure", async () => {
    const renderer = makeRenderer({
      synchronize: true,
      syncedTopics: { "/video": true },
    });
    const images = new TestImages(renderer);
    images.displayResults.push({ ok: false, reason: "failed" }, { ok: true });
    const subscription = compressedVideoSubscription(images);
    const target = makeVideoMessage(10n, "key");
    const context: RendererSubscriptionContext = {
      ...PLAYBACK_CONTEXT,
      syncResult: {
        found: true,
        timestamp: target.message.timestamp,
        messages: new Map([[target.topic, target]]),
      },
    };

    await subscription.processQueue?.([target], context);
    await subscription.processQueue?.([], context);

    expect(images.createdRenderables[0]!.setCompressedVideoFrameBatches).toEqual([
      [target.message],
      [target.message],
    ]);
  });
});
