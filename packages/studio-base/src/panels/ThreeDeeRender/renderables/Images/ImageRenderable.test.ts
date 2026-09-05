/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as THREE from "three";

import { PinholeCameraModel } from "@foxglove/den/image";
import { IRenderer } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";

import {
  type CompressedVideoFrameEvent,
  ImageRenderable,
  IMAGE_RENDERABLE_DEFAULT_SETTINGS,
  ImageUserData,
} from "./ImageRenderable";
import type { AnyImage, CompressedVideo } from "./ImageTypes";
import {
  AwaitTargetFrameResult,
  DecodeVideoFramesArgs,
  DecodeVideoFramesResult,
  WorkerImageDecoder,
} from "./WorkerImageDecoder";

const mockAdd = jest.fn();
const mockAddToTopic = jest.fn();
const mockRemove = jest.fn();
const mockRemoveFromTopic = jest.fn();

class MockVideoFrame {
  public readonly displayWidth: number;
  public readonly displayHeight: number;
  public readonly close = jest.fn();

  public constructor(displayWidth = 640, displayHeight = 480) {
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
  }
}

// Mocked dependencies
const emitter = new EventEmitter();
const mockRenderer: IRenderer = Object.assign(emitter, {
  currentTime: 1_000_000_000_000n,
  isPlaybackStopped: jest.fn(() => false),
  queueAnimationFrame: jest.fn(),
  normalizeFrameId: jest.fn((id) => id),
  settings: {
    errors: {
      add: mockAdd,
      addToTopic: mockAddToTopic,
      remove: mockRemove,
      removeFromTopic: mockRemoveFromTopic,
    },
  },
}) as unknown as IRenderer;

const mockUserData: ImageUserData = {
  topic: "/test/image",
  settings: { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS },
  firstMessageTime: BigInt(0),
  cameraInfo: undefined,
  cameraModel: undefined,
  image: undefined,
  texture: undefined,
  material: undefined,
  geometry: undefined,
  mesh: undefined,
  frameId: "frame",
  messageTime: 0n,
  receiveTime: 0n,
  pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  settingsPath: [],
};

// Simplest image format test case
const sampleImage = {
  format: "jpeg",
  data: new Uint8Array([1, 2, 3]), // fake data
  header: { frame_id: "camera", stamp: { sec: 0, nsec: 1 } },
};

const sampleVideo: CompressedVideo = {
  format: "h264",
  data: new Uint8Array([0, 0, 0, 1, 0x65]),
  timestamp: { sec: 0, nsec: 1 },
  frame_id: "camera",
};

function videoFrame(timestampNsec: number, kind: "key" | "delta"): CompressedVideo {
  return {
    ...sampleVideo,
    data: new Uint8Array([0, 0, 0, 1, kind === "key" ? 0x65 : 0x41]),
    timestamp: { sec: 0, nsec: timestampNsec },
  };
}

function timeFromNanoseconds(timestamp: bigint) {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function videoFrameEvent(
  receiveTimestamp: bigint,
  timestampNsec: number,
  kind: "key" | "delta",
): CompressedVideoFrameEvent {
  return {
    topic: mockUserData.topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: timeFromNanoseconds(receiveTimestamp),
    message: videoFrame(timestampNsec, kind),
    sizeInBytes: 1,
  };
}

function abortAwaitTargetFrame(): jest.Mock<
  Promise<AwaitTargetFrameResult>,
  [{ requestId: number }]
> {
  return jest.fn(
    async ({ requestId }): Promise<AwaitTargetFrameResult> => ({ type: "Aborted", requestId }),
  );
}

type TestDecodedImage = ImageBitmap | ImageData | VideoFrame;

function makeUserData(): ImageUserData {
  return {
    ...mockUserData,
    settings: { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS },
    texture: undefined,
    material: undefined,
    geometry: undefined,
    mesh: undefined,
    image: undefined,
  };
}

class TestImageRenderable extends ImageRenderable {
  readonly #decodedImages: (TestDecodedImage | Promise<TestDecodedImage>)[];

  public constructor(decodedImages: (TestDecodedImage | Promise<TestDecodedImage>)[]) {
    super(mockUserData.topic, mockRenderer, makeUserData());
    this.#decodedImages = decodedImages;
  }

  protected override async decodeImage(
    _image: AnyImage,
    _resizeWidth?: number,
  ): Promise<TestDecodedImage> {
    const decodedImage = this.#decodedImages.shift();
    if (!decodedImage) {
      throw new Error("No decoded image queued");
    }
    return await decodedImage;
  }

  protected override async decodeImageWithResult(
    image: AnyImage,
    resizeWidth?: number,
  ): Promise<{ image: TestDecodedImage; ok: true }> {
    return { image: await this.decodeImage(image, resizeWidth), ok: true };
  }
}

class TestVideoBatchRenderable extends ImageRenderable {
  public constructor(decoder: WorkerImageDecoder) {
    super(mockUserData.topic, mockRenderer, makeUserData());
    this.decoder = decoder;
  }
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

function makeDecodeVideoFramesMock(decodedFrames: Array<VideoFrame | undefined>) {
  return jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
    async ({ frames, requestId }): Promise<DecodeVideoFramesResult> => {
      const decodedFrame = decodedFrames.shift();
      if (decodedFrame == undefined) {
        return { type: "Timeout", requestId };
      }
      const target = frames[frames.length - 1]!;
      return {
        type: "TargetFrame",
        requestId,
        frame: decodedFrame,
        originalTimestamp:
          BigInt(target.frame.timestamp.sec) * 1_000_000_000n + BigInt(target.frame.timestamp.nsec),
        receiveTime: target.receiveTime,
      };
    },
  );
}

function commit() {
  emitter.emit("startFrame", mockRenderer.currentTime, mockRenderer);
}

describe("ImageRenderable candidate scheduling", () => {
  let originalVideoFrame: unknown;
  beforeAll(() => {
    originalVideoFrame = globalThis.VideoFrame;
    (globalThis as unknown as { VideoFrame: unknown }).VideoFrame = MockVideoFrame;
  });
  afterAll(() => {
    (globalThis as unknown as { VideoFrame: unknown }).VideoFrame = originalVideoFrame;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    emitter.removeAllListeners();
    mockRenderer.currentTime = 1_000_000_000_000n;
    (mockRenderer.isPlaybackStopped as jest.Mock).mockReturnValue(false);
  });

  it("stages decoded pixels and metadata until the same rAF commit", async () => {
    const decoded = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestImageRenderable([decoded]);
    const pending = renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 1 },
    });
    expect(renderable.getDecodedImage()).toBeUndefined();
    await pending;
    expect(renderable.userData.image).toBeUndefined();
    expect(renderable.getDecodedImage()).toBeUndefined();
    commit();
    expect(renderable.getDecodedImage()).toBe(decoded);
    expect(renderable.userData.image).toBe(sampleImage);
    expect(renderable.userData.receiveTime).toBe(1n);
    expect(renderable.userData.messageTime).toBe(1n);
    renderable.dispose();
  });

  it("lets a legal older active image display and decodes only the latest pending target", async () => {
    let resolve!: (frame: VideoFrame) => void;
    const firstFrame = new MockVideoFrame() as unknown as VideoFrame;
    const lastFrame = new MockVideoFrame() as unknown as VideoFrame;
    const active = new Promise<VideoFrame>((done) => {
      resolve = done;
    });
    const renderable = new TestImageRenderable([active, lastFrame]);
    const first = renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 1 },
    });
    await flushPromises();
    const skipped = renderable.setImage({ ...sampleImage }, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 2 },
    });
    const latest = renderable.setImage({ ...sampleImage }, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 3 },
    });
    await expect(skipped).resolves.toMatchObject({ ok: false, reason: "stale" });
    resolve(firstFrame);
    await first;
    commit();
    expect(renderable.userData.receiveTime).toBe(1n);
    await latest;
    commit();
    expect(renderable.userData.receiveTime).toBe(3n);
    expect((firstFrame as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    renderable.dispose();
  });

  it("closes overwritten candidates and commits only the newest", async () => {
    const first = new MockVideoFrame() as unknown as VideoFrame;
    const second = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestImageRenderable([first, second]);
    await renderable.setImage(sampleImage);
    await renderable.setImage({ ...sampleImage });
    expect((first as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    commit();
    expect(renderable.getDecodedImage()).toBe(second);
    renderable.dispose();
    expect((second as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
  });

  it("closes future candidates instead of displaying ahead of the head", async () => {
    const frame = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestImageRenderable([frame]);
    mockRenderer.currentTime = 0n;
    await renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 1 },
    });
    commit();
    expect(renderable.getDecodedImage()).toBeUndefined();
    expect((frame as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
  });

  it("does not display backwards within a generation but permits a backwards seek", async () => {
    const renderable = new TestImageRenderable(
      Array.from({ length: 3 }, () => new MockVideoFrame() as unknown as VideoFrame),
    );
    await renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 2 },
    });
    commit();
    await renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 1 },
    });
    commit();
    expect(renderable.userData.receiveTime).toBe(2n);
    renderable.resetForSeek();
    await renderable.setImage(sampleImage, undefined, undefined, {
      receiveTime: { sec: 0, nsec: 1 },
    });
    commit();
    expect(renderable.userData.receiveTime).toBe(1n);
    renderable.dispose();
  });

  it("invalidates pending and active JPEG outputs on seek", async () => {
    let resolve!: (frame: VideoFrame) => void;
    const image = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestImageRenderable([
      new Promise((done) => {
        resolve = done;
      }),
    ]);
    const active = renderable.setImage(sampleImage);
    await flushPromises();
    const pending = renderable.setImage(sampleImage);
    renderable.resetForSeek();
    resolve(image);
    await expect(active).resolves.toMatchObject({ ok: false, reason: "stale" });
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "stale" });
    commit();
    expect((image as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    expect(renderable.getDecodedImage()).toBeUndefined();
    renderable.dispose();
  });

  it("drops stopped JPEG pending instead of sequentially updating the tail", async () => {
    let resolve!: (frame: VideoFrame) => void;
    const image = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestImageRenderable([
      new Promise((done) => {
        resolve = done;
      }),
    ]);
    const active = renderable.setImage(sampleImage);
    await flushPromises();
    const pending = renderable.setImage({ ...sampleImage });
    (mockRenderer.isPlaybackStopped as jest.Mock).mockReturnValue(true);
    commit();
    await expect(pending).resolves.toMatchObject({ ok: false });
    resolve(image);
    await active;
    commit();
    expect(renderable.getDecodedImage()).toBeUndefined();
    renderable.dispose();
  });

  it("maps an intermediate to its actual event and keeps metadata unchanged until rAF", async () => {
    const frame = new MockVideoFrame() as unknown as VideoFrame;
    const first = videoFrameEvent(1n, 1, "key");
    const last = videoFrameEvent(2n, 2, "delta");
    const decodeVideoFrames = jest.fn(
      async ({ requestId }: DecodeVideoFramesArgs): Promise<DecodeVideoFramesResult> => ({
        type: "IntermediateFrame",
        requestId,
        frame,
        receiveTime: 1n,
        originalTimestamp: 1n,
        batchIndex: 0,
      }),
    );
    const awaitTargetFrame = abortAwaitTargetFrame();
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames,
      awaitTargetFrame,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    const update = jest.fn();
    await renderable.setCompressedVideoFrames([first, last], {
      updateImageState: update,
      retainLateTarget: false,
    });
    expect(decodeVideoFrames).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    commit();
    expect(update).toHaveBeenCalledWith(first);
    expect(renderable.userData.receiveTime).toBe(1n);
    expect(awaitTargetFrame).not.toHaveBeenCalled();
    renderable.dispose();
  });

  it("duplicate video timestamps use the actual batch position", async () => {
    const frame = new MockVideoFrame() as unknown as VideoFrame;
    const first = videoFrameEvent(1n, 1, "key");
    const last = {
      ...videoFrameEvent(1n, 1, "delta"),
      message: { ...sampleVideo, frame_id: "last" },
    };
    const decodeVideoFrames = jest.fn(
      async ({ requestId }: DecodeVideoFramesArgs): Promise<DecodeVideoFramesResult> => ({
        type: "TargetFrame",
        requestId,
        frame,
        receiveTime: 1n,
        originalTimestamp: 1n,
        batchIndex: 1,
      }),
    );
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await renderable.setCompressedVideoFrames([first, last]);
    commit();
    expect(renderable.userData.image).toBe(last.message);
    renderable.dispose();
  });

  it("a missing annotation match drops only the candidate, not decoder continuity", async () => {
    const frame = new MockVideoFrame() as unknown as VideoFrame;
    const decodeVideoFrames = makeDecodeVideoFramesMock([frame]);
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await expect(
      renderable.setCompressedVideoFrames([videoFrameEvent(1n, 1, "key")], {
        canDisplayFrame: () => false,
      }),
    ).resolves.toMatchObject({ ok: true });
    commit();
    expect(renderable.getDecodedImage()).toBeUndefined();
    expect((frame as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    renderable.dispose();
  });

  it("playback timeouts keep the last image and do not request a late target", async () => {
    const frame = new MockVideoFrame() as unknown as VideoFrame;
    const awaitTargetFrame = abortAwaitTargetFrame();
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames: makeDecodeVideoFramesMock([frame, undefined]),
      awaitTargetFrame,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await renderable.setCompressedVideoFrames([videoFrameEvent(1n, 1, "key")]);
    commit();
    await expect(
      renderable.setCompressedVideoFrames([videoFrameEvent(2n, 2, "delta")]),
    ).resolves.toMatchObject({ ok: false, reason: "timeout" });
    commit();
    expect(renderable.getDecodedImage()).toBe(frame);
    expect(awaitTargetFrame).not.toHaveBeenCalled();
    renderable.dispose();
  });

  it("seek keeps at most one late correction without holding the current batch", async () => {
    let resolve!: (result: AwaitTargetFrameResult) => void;
    const late = new MockVideoFrame() as unknown as VideoFrame;
    const target = videoFrameEvent(1n, 1, "key");
    const awaitTargetFrame = jest.fn(
      async () =>
        await new Promise<AwaitTargetFrameResult>((done) => {
          resolve = done;
        }),
    );
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames: makeDecodeVideoFramesMock([undefined]),
      awaitTargetFrame,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await expect(
      renderable.setCompressedVideoFrames([target], { retainLateTarget: true }),
    ).resolves.toMatchObject({ reason: "timeout" });
    expect(awaitTargetFrame).toHaveBeenCalledTimes(1);
    resolve({
      type: "TargetFrame",
      requestId: 1,
      frame: late,
      receiveTime: 1n,
      originalTimestamp: 1n,
    });
    await flushPromises();
    expect(renderable.getDecodedImage()).toBeUndefined();
    commit();
    expect(renderable.getDecodedImage()).toBe(late);
    renderable.dispose();
  });

  it("closes a seek late correction after generation invalidation", async () => {
    let resolve!: (result: AwaitTargetFrameResult) => void;
    const late = new MockVideoFrame() as unknown as VideoFrame;
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames: makeDecodeVideoFramesMock([undefined]),
      awaitTargetFrame: async () =>
        await new Promise<AwaitTargetFrameResult>((done) => {
          resolve = done;
        }),
      resetVideoDecoder: jest.fn(async () => {}),
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await renderable.setCompressedVideoFrames([videoFrameEvent(1n, 1, "key")], {
      retainLateTarget: true,
    });
    renderable.resetForSeek();
    resolve({
      type: "TargetFrame",
      requestId: 1,
      frame: late,
      receiveTime: 1n,
      originalTimestamp: 1n,
    });
    await flushPromises();
    commit();
    expect((late as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    expect(renderable.getDecodedImage()).toBeUndefined();
    renderable.dispose();
  });
  it("cancels a seek late target and closes a reply racing that cancellation", async () => {
    let resolve!: (result: AwaitTargetFrameResult) => void;
    const late = new MockVideoFrame() as unknown as VideoFrame;
    const cancelTargetFrame = jest.fn(async () => {});
    const renderable = new TestVideoBatchRenderable({
      decodeVideoFrames: makeDecodeVideoFramesMock([undefined]),
      awaitTargetFrame: async () =>
        await new Promise<AwaitTargetFrameResult>((done) => {
          resolve = done;
        }),
      cancelTargetFrame,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder);
    await renderable.setCompressedVideoFrames([videoFrameEvent(1n, 1, "key")], {
      retainLateTarget: true,
    });
    renderable.cancelLateTargetFrame();
    expect(cancelTargetFrame).toHaveBeenCalledWith(1);
    resolve({
      type: "TargetFrame",
      requestId: 1,
      frame: late,
      receiveTime: 1n,
      originalTimestamp: 1n,
    });
    await flushPromises();
    commit();
    expect((late as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
    expect(renderable.getDecodedImage()).toBeUndefined();
    renderable.dispose();
  });
  it("should instantiate and set settings", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });
    expect(renderable).toBeInstanceOf(ImageRenderable);

    const newSettings = { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, distance: 2 };
    renderable.setSettings(newSettings);
    expect(renderable.userData.settings.distance).toBe(2);
  });

  it("does not start a new compressed video decode when display settings change", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, makeUserData());
    renderable.userData.image = sampleVideo;
    const setImage = jest.spyOn(renderable, "setImage").mockResolvedValue({ ok: true });

    renderable.setSettings({
      ...renderable.userData.settings,
      flatColor: "#ff0000",
    });

    expect(setImage).not.toHaveBeenCalled();
  });

  it("should set a new brightness value", () => {
    const newBrightnessValue = 1;
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });

    renderable.userData.texture = new THREE.Texture();
    renderable.userData.material = new THREE.ShaderMaterial();
    renderable.setSettings({ ...renderable.userData.settings, brightness: newBrightnessValue });
    renderable.userData.geometry = new THREE.PlaneGeometry();

    expect(renderable.userData.settings.brightness).toBe(newBrightnessValue);
  });

  it("should set a new contrast value", () => {
    const newContrastValue = 1;
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });

    renderable.userData.texture = new THREE.Texture();
    renderable.userData.material = new THREE.ShaderMaterial();
    renderable.setSettings({ ...renderable.userData.settings, contrast: newContrastValue });
    renderable.userData.geometry = new THREE.PlaneGeometry();

    expect(renderable.userData.settings.contrast).toBe(newContrastValue);
  });

  it("should set camera model", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });
    const model = new PinholeCameraModel({
      width: 100,
      height: 100,
      binning_x: 0,
      binning_y: 0,
      D: [1, 2, 3, 4, 5, 6, 7, 8],
      distortion_model: "",
      K: [],
      P: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      R: [],
      roi: {
        x_offset: 0,
        y_offset: 0,
        height: 0,
        width: 0,
        do_rectify: false,
      },
    });
    renderable.setCameraModel(model);
    expect(renderable.userData.cameraModel).toBe(model);
  });
});
describe("ImageRenderable error handling", () => {
  let originalVideoFrame: unknown;

  beforeAll(() => {
    const globals = globalThis as unknown as { VideoFrame?: unknown };
    originalVideoFrame = globals.VideoFrame;
    globals.VideoFrame = MockVideoFrame;
  });

  afterAll(() => {
    const globals = globalThis as unknown as { VideoFrame?: unknown };
    globals.VideoFrame = originalVideoFrame;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("should call renderer error methods on addError", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, {
      ...mockUserData,
    });

    const mockErrorKey = "test error key";
    const mockErrorMessage = "test error message";

    // @ts-expect-error addError is protected, but ok to use on tests
    renderable.addError(mockErrorKey, mockErrorMessage);

    expect(mockAdd).toHaveBeenCalledWith(
      ["imageMode", "imageTopic"],
      mockErrorKey,
      mockErrorMessage,
    );
    expect(mockAddToTopic).toHaveBeenCalledWith(mockUserData.topic, mockErrorKey, mockErrorMessage);
  });

  it("should not call addError in case of renderable is disposed", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, {
      ...mockUserData,
    });

    renderable.dispose();

    // @ts-expect-error addError is protected, but ok to use on tests
    renderable.addError("test error key", "test error message");

    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockAddToTopic).not.toHaveBeenCalled();
  });

  it("should call renderer error methods on removeError", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });

    // @ts-expect-error removeError is protected, but ok to use on tests
    renderable.removeError("decode");
    expect(mockRemove).toHaveBeenCalledWith(["imageMode", "imageTopic"], "decode");
    expect(mockRemoveFromTopic).toHaveBeenCalledWith(mockUserData.topic, "decode");
  });
});
