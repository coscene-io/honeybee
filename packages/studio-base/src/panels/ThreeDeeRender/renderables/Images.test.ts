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

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeVideoMessage(timestamp: bigint, type: "key" | "delta"): MessageEvent<CompressedVideo> {
  return {
    topic: "/video",
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
      return { ok: false };
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
  } = {},
): IRenderer {
  const emitter = new EventEmitter();
  const topics = [
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
    topics: options.topicSettings ?? {
      "/video": { visible: true },
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
