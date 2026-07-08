/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";
import * as THREE from "three";

import { PinholeCameraModel } from "@foxglove/den/image";
import { IRenderer } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";

import {
  type CompressedVideoFrameEvent,
  ImageRenderable,
  IMAGE_RENDERABLE_DEFAULT_SETTINGS,
  ImageSetImageResult,
  ImageUserData,
} from "./ImageRenderable";
import type { AnyImage, CompressedVideo } from "./ImageTypes";
import {
  AwaitTargetFrameResult,
  DecodedVideoFrame,
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
const mockRenderer: IRenderer = {
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
} as unknown as IRenderer;

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
  await Promise.resolve();
  await Promise.resolve();
}

function mockDateNow(start = 1_000): { advance: (ms: number) => void; restore: () => void } {
  let now = start;
  const spy = jest.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
    restore: () => {
      spy.mockRestore();
    },
  };
}

function makeDecodeVideoFrameMock(decodedFrames: Array<VideoFrame | undefined>) {
  return jest.fn<Promise<DecodedVideoFrame | undefined>, [CompressedVideo, bigint]>(
    async (frame, receiveTime): Promise<DecodedVideoFrame | undefined> => {
      const decodedFrame = decodedFrames.shift();
      if (decodedFrame == undefined) {
        return undefined;
      }
      return {
        frame: decodedFrame,
        originalTimestamp:
          BigInt(frame.timestamp.sec) * 1_000_000_000n + BigInt(frame.timestamp.nsec),
        receiveTime,
      };
    },
  );
}

describe("ImageRenderable", () => {
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

  it("should instantiate and set settings", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });
    expect(renderable).toBeInstanceOf(ImageRenderable);

    const newSettings = { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, distance: 2 };
    renderable.setSettings(newSettings);
    expect(renderable.userData.settings.distance).toBe(2);
  });

  it("should set and decode image", async () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });
    void renderable.setImage(sampleImage);
    expect(renderable.userData.image).toBe(sampleImage);
    expect(renderable.getDecodedImage()).toBe(undefined);

    // @ts-expect-error decodeImage is protected, but ok to use on tests
    await renderable.decodeImage(renderable.userData.image!, 100);
    expect(renderable.getDecodedImage()).toBeInstanceOf(ImageBitmap);
  });

  it("should dispose resources", () => {
    const renderable = new ImageRenderable(mockUserData.topic, mockRenderer, { ...mockUserData });
    renderable.userData.texture = new THREE.Texture();
    renderable.userData.material = new THREE.ShaderMaterial();
    renderable.userData.geometry = new THREE.PlaneGeometry();

    // @ts-expect-error isDisposed is protected, but ok to use on tests
    expect(renderable.isDisposed()).toBe(false);

    renderable.dispose();

    // @ts-expect-error isDisposed is protected, but ok to use on tests
    expect(renderable.isDisposed()).toBe(true);
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

  it("should update texture and queue render for a new video frame", async () => {
    const time = mockDateNow();
    try {
      const frame = new MockVideoFrame() as unknown as VideoFrame;
      const onDecoded = jest.fn();
      const renderable = new TestImageRenderable([frame]);

      void renderable.setImage(sampleVideo, undefined, onDecoded);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame);
      expect(renderable.userData.texture?.image).toBe(frame);
      expect(mockRenderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
      expect(onDecoded).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
    }
  });

  it("should skip texture update and render when video decode reuses the current frame", async () => {
    const time = mockDateNow();
    try {
      const frame = new MockVideoFrame() as unknown as VideoFrame;
      const onDecoded = jest.fn();
      const renderable = new TestImageRenderable([frame, frame]);

      void renderable.setImage(sampleVideo, undefined, onDecoded);
      await flushPromises();

      time.advance(20);
      jest.clearAllMocks();
      void renderable.setImage(
        { ...sampleVideo, timestamp: { sec: 0, nsec: 2 } },
        undefined,
        onDecoded,
      );
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame);
      expect(renderable.userData.texture?.image).toBe(frame);
      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();
      expect(onDecoded).not.toHaveBeenCalled();
      expect((frame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("should reject an older decoded frame after a newer decode reuses the current frame", async () => {
    const time = mockDateNow();
    try {
      const frame = new MockVideoFrame() as unknown as VideoFrame;
      const staleFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveStaleFrame!: (value: TestDecodedImage) => void;
      const staleFramePromise = new Promise<TestDecodedImage>((resolve) => {
        resolveStaleFrame = resolve;
      });
      const renderable = new TestImageRenderable([frame, staleFramePromise, frame]);

      void renderable.setImage(sampleVideo);
      await flushPromises();

      time.advance(20);
      jest.clearAllMocks();
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 2 } });

      time.advance(20);
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 3 } });
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame);
      expect(renderable.userData.texture?.image).toBe(frame);
      expect(renderable.userData.messageTime).toBe(3n);

      resolveStaleFrame(staleFrame);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame);
      expect(renderable.userData.texture?.image).toBe(frame);
      expect((staleFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("should close the previous video frame once when replacing it", async () => {
    const time = mockDateNow();
    try {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;
      const renderable = new TestImageRenderable([frame1, frame2]);

      void renderable.setImage(sampleVideo);
      await flushPromises();

      time.advance(20);
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 2 } });
      await flushPromises();

      expect(renderable.userData.texture?.image).toBe(frame2);
      expect((frame1 as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect((frame2 as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("flushes the newest decoded frame after the render throttle window", async () => {
    jest.useFakeTimers();
    const time = mockDateNow();
    try {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;
      const onDecoded = jest.fn();
      const renderable = new TestImageRenderable([frame1, frame2]);

      void renderable.setImage(sampleVideo, undefined, onDecoded);
      await flushPromises();

      time.advance(1);
      jest.clearAllMocks();
      void renderable.setImage(
        { ...sampleVideo, timestamp: { sec: 0, nsec: 2 } },
        undefined,
        onDecoded,
      );
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame1);
      expect(renderable.userData.texture?.image).toBe(frame1);
      expect((frame2 as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();

      time.advance(15);
      jest.advanceTimersByTime(15);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(frame2);
      expect(renderable.userData.texture?.image).toBe(frame2);
      expect((frame1 as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect((frame2 as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(mockRenderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
      expect(onDecoded).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
      jest.useRealTimers();
    }
  });

  it("closes the replaced pending decoded frame", async () => {
    jest.useFakeTimers();
    const time = mockDateNow();
    try {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const pendingFrame = new MockVideoFrame() as unknown as VideoFrame;
      const newestFrame = new MockVideoFrame() as unknown as VideoFrame;
      const renderable = new TestImageRenderable([frame1, pendingFrame, newestFrame]);

      void renderable.setImage(sampleVideo);
      await flushPromises();

      time.advance(1);
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 2 } });
      await flushPromises();

      time.advance(1);
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 3 } });
      await flushPromises();

      expect((pendingFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);

      time.advance(15);
      jest.advanceTimersByTime(15);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(newestFrame);
      expect((newestFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
      jest.useRealTimers();
    }
  });

  it("uses a custom display interval for compressed playback frames", async () => {
    jest.useFakeTimers();
    const time = mockDateNow();
    try {
      const firstFrame = new MockVideoFrame() as unknown as VideoFrame;
      const pendingFrame = new MockVideoFrame() as unknown as VideoFrame;
      const newestFrame = new MockVideoFrame() as unknown as VideoFrame;
      const firstEvent = videoFrameEvent(0n, 1, "key");
      const pendingEvent = videoFrameEvent(10n, 2, "delta");
      const newestEvent = videoFrameEvent(20n, 3, "delta");
      const updateImageState = jest.fn();
      const decodeVideoFrame = makeDecodeVideoFrameMock([firstFrame, pendingFrame, newestFrame]);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);

      await expect(
        renderable.setCompressedVideoFrames([firstEvent], {
          minDisplayIntervalMs: 33,
          updateImageState,
        }),
      ).resolves.toMatchObject({ ok: true, decodedFrame: firstEvent });

      time.advance(1);
      jest.clearAllMocks();
      const pendingResult = renderable.setCompressedVideoFrames([pendingEvent], {
        minDisplayIntervalMs: 33,
        updateImageState,
      });
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(firstFrame);
      expect(updateImageState).not.toHaveBeenCalled();

      time.advance(1);
      const newestResult = renderable.setCompressedVideoFrames([newestEvent], {
        minDisplayIntervalMs: 33,
        updateImageState,
      });
      await flushPromises();

      await expect(pendingResult).resolves.toEqual({ ok: false, reason: "failed" });
      expect((pendingFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect(updateImageState).not.toHaveBeenCalled();

      time.advance(15);
      jest.advanceTimersByTime(15);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(firstFrame);
      expect(updateImageState).not.toHaveBeenCalled();

      time.advance(17);
      jest.advanceTimersByTime(17);
      await flushPromises();

      await expect(newestResult).resolves.toMatchObject({ ok: true, decodedFrame: newestEvent });
      expect(renderable.getDecodedImage()).toBe(newestFrame);
      expect((newestFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(updateImageState).toHaveBeenCalledTimes(1);
      expect(updateImageState).toHaveBeenCalledWith(newestEvent);
      expect(mockRenderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
      jest.useRealTimers();
    }
  });

  it("keeps the default compressed playback display interval when no override is provided", async () => {
    jest.useFakeTimers();
    const time = mockDateNow();
    try {
      const firstFrame = new MockVideoFrame() as unknown as VideoFrame;
      const secondFrame = new MockVideoFrame() as unknown as VideoFrame;
      const firstEvent = videoFrameEvent(0n, 1, "key");
      const secondEvent = videoFrameEvent(10n, 2, "delta");
      const decodeVideoFrame = makeDecodeVideoFrameMock([firstFrame, secondFrame]);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);

      await expect(renderable.setCompressedVideoFrames([firstEvent])).resolves.toMatchObject({
        ok: true,
      });

      time.advance(1);
      jest.clearAllMocks();
      const secondResult = renderable.setCompressedVideoFrames([secondEvent]);
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(firstFrame);
      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();

      time.advance(15);
      jest.advanceTimersByTime(15);
      await flushPromises();

      await expect(secondResult).resolves.toMatchObject({ ok: true });
      expect(renderable.getDecodedImage()).toBe(secondFrame);
      expect(mockRenderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
      jest.useRealTimers();
    }
  });

  it("displays an in-flight playback frame after a newer playback message arrives", async () => {
    const time = mockDateNow();
    try {
      const decodedFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveFirstDecode: ((result: DecodedVideoFrame | undefined) => void) | undefined;
      const firstDecodePromise = new Promise<DecodedVideoFrame | undefined>((resolve) => {
        resolveFirstDecode = resolve;
      });
      const decodeVideoFrame = jest
        .fn<Promise<DecodedVideoFrame | undefined>, [CompressedVideo, bigint]>()
        .mockImplementationOnce(async () => await firstDecodePromise)
        .mockResolvedValueOnce(undefined);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const firstEvent = videoFrameEvent(10n, 1, "key");
      const secondEvent = videoFrameEvent(20n, 2, "delta");
      const updateImageState = jest.fn();

      const firstResult = renderable.setCompressedVideoFrames([firstEvent], { updateImageState });
      await flushPromises();

      time.advance(1);
      const secondResult = renderable.setCompressedVideoFrames([secondEvent], { updateImageState });
      await flushPromises();

      await expect(secondResult).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "failed",
      });

      time.advance(20);
      if (resolveFirstDecode == undefined) {
        throw new Error("Expected pending playback decode");
      }
      resolveFirstDecode({ frame: decodedFrame, originalTimestamp: 1n, receiveTime: 10n });
      await flushPromises();

      await expect(firstResult).resolves.toMatchObject({ ok: true, decodedFrame: firstEvent });
      expect(renderable.getDecodedImage()).toBe(decodedFrame);
      expect((decodedFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(updateImageState).toHaveBeenCalledTimes(1);
      expect(updateImageState).toHaveBeenCalledWith(firstEvent);
      expect(renderable.userData.displayedFrameState).toEqual({
        image: firstEvent.message,
        receiveTime: 10n,
      });
      expect(renderable.userData.latestMessageState).toEqual({
        image: secondEvent.message,
        receiveTime: 20n,
      });
    } finally {
      time.restore();
    }
  });

  it("does not make an in-flight playback frame stale when a newer message reuses the current frame", async () => {
    const time = mockDateNow();
    try {
      const initialFrame = new MockVideoFrame() as unknown as VideoFrame;
      const delayedFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveDelayedDecode: ((result: DecodedVideoFrame | undefined) => void) | undefined;
      const delayedDecodePromise = new Promise<DecodedVideoFrame | undefined>((resolve) => {
        resolveDelayedDecode = resolve;
      });
      const decodeVideoFrame = jest
        .fn<Promise<DecodedVideoFrame | undefined>, [CompressedVideo, bigint]>()
        .mockResolvedValueOnce({ frame: initialFrame, originalTimestamp: 1n, receiveTime: 10n })
        .mockImplementationOnce(async () => await delayedDecodePromise)
        .mockResolvedValueOnce(undefined);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const initialEvent = videoFrameEvent(10n, 1, "key");
      const delayedEvent = videoFrameEvent(20n, 2, "delta");
      const latestEvent = videoFrameEvent(30n, 3, "delta");
      const updateImageState = jest.fn();

      await expect(
        renderable.setCompressedVideoFrames([initialEvent], { updateImageState }),
      ).resolves.toMatchObject({ ok: true, decodedFrame: initialEvent });
      updateImageState.mockClear();

      time.advance(20);
      const delayedResult = renderable.setCompressedVideoFrames([delayedEvent], {
        updateImageState,
      });
      await flushPromises();

      time.advance(1);
      await expect(
        renderable.setCompressedVideoFrames([latestEvent], { updateImageState }),
      ).resolves.toEqual<ImageSetImageResult>({ ok: true });
      expect(renderable.getDecodedImage()).toBe(initialFrame);
      expect(updateImageState).not.toHaveBeenCalled();

      time.advance(20);
      if (resolveDelayedDecode == undefined) {
        throw new Error("Expected delayed playback decode");
      }
      resolveDelayedDecode({ frame: delayedFrame, originalTimestamp: 2n, receiveTime: 20n });
      await flushPromises();

      await expect(delayedResult).resolves.toMatchObject({ ok: true, decodedFrame: delayedEvent });
      expect(renderable.getDecodedImage()).toBe(delayedFrame);
      expect((delayedFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(updateImageState).toHaveBeenCalledTimes(1);
      expect(updateImageState).toHaveBeenCalledWith(delayedEvent);
      expect(renderable.userData.latestMessageState).toEqual({
        image: latestEvent.message,
        receiveTime: 30n,
      });
      expect(renderable.userData.displayedFrameState).toEqual({
        image: delayedEvent.message,
        receiveTime: 20n,
      });
    } finally {
      time.restore();
    }
  });

  it("closes pending decoded frame and cancels its timer on dispose", async () => {
    jest.useFakeTimers();
    const time = mockDateNow();
    try {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const pendingFrame = new MockVideoFrame() as unknown as VideoFrame;
      const renderable = new TestImageRenderable([frame1, pendingFrame]);

      void renderable.setImage(sampleVideo);
      await flushPromises();

      time.advance(1);
      jest.clearAllMocks();
      void renderable.setImage({ ...sampleVideo, timestamp: { sec: 0, nsec: 2 } });
      await flushPromises();

      renderable.dispose();
      expect((pendingFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);

      time.advance(15);
      jest.advanceTimersByTime(15);
      await flushPromises();

      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();
    } finally {
      time.restore();
      jest.useRealTimers();
    }
  });

  it("should not close the same video frame twice on dispose", async () => {
    const time = mockDateNow();
    try {
      const frame = new MockVideoFrame() as unknown as VideoFrame;
      const renderable = new TestImageRenderable([frame]);

      void renderable.setImage(sampleVideo);
      await flushPromises();
      renderable.dispose();

      expect((frame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
    }
  });

  it("submits compressed playback frames one at a time without exact batch replay", async () => {
    const time = mockDateNow();
    try {
      const keyFrame = new MockVideoFrame() as unknown as VideoFrame;
      const deltaFrame = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrame = makeDecodeVideoFrameMock([keyFrame, deltaFrame]);
      const decodeVideoFrames = jest.fn();
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames,
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;

      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const delta = videoFrameEvent(20n, 2, "delta");

      await expect(renderable.setCompressedVideoFrames([keyframe])).resolves.toMatchObject({
        ok: true,
        decodedFrame: keyframe,
      });
      time.advance(20);
      await expect(renderable.setCompressedVideoFrames([delta])).resolves.toMatchObject({
        ok: true,
        decodedFrame: delta,
      });

      expect(decodeVideoFrame).toHaveBeenCalledTimes(2);
      expect(decodeVideoFrame.mock.calls.map((call) => call[1])).toEqual([10n, 20n]);
      expect(decodeVideoFrames).not.toHaveBeenCalled();
      expect(renderable.getDecodedImage()).toBe(deltaFrame);
    } finally {
      time.restore();
    }
  });

  it("decodes explicit compressed video frame batches with one worker call", async () => {
    const time = mockDateNow();
    try {
      const frame = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrames = jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
        async ({ requestId }) => ({
          type: "TargetFrame",
          requestId,
          frame,
          originalTimestamp: 2n,
          receiveTime: 20n,
        }),
      );
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const delta = videoFrameEvent(20n, 2, "delta");
      const updateImageState = jest.fn();

      await expect(
        renderable.setCompressedVideoFrames([keyframe, delta], {
          decodeMode: "exact",
          updateImageState,
        }),
      ).resolves.toMatchObject({ ok: true, decodedFrame: delta });

      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);
      expect(decodeVideoFrames.mock.calls[0]![0].frames.map((entry) => entry.receiveTime)).toEqual([
        10n,
        20n,
      ]);
      expect(renderable.getDecodedImage()).toBe(frame);
      expect(renderable.userData.image).toBe(delta.message);
      expect(updateImageState).toHaveBeenCalledTimes(1);
      expect(updateImageState).toHaveBeenCalledWith(delta);
    } finally {
      time.restore();
    }
  });

  it("keeps received playback metadata separate from the displayed decoded frame", async () => {
    const time = mockDateNow();
    try {
      const keyDecodedFrame = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrame = makeDecodeVideoFrameMock([keyDecodedFrame, undefined]);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const delta = videoFrameEvent(20n, 2, "delta");
      const updateImageState = jest.fn();

      await expect(
        renderable.setCompressedVideoFrames([keyframe], { updateImageState }),
      ).resolves.toMatchObject({ ok: true, decodedFrame: keyframe });
      expect(renderable.userData.latestMessageState).toEqual({
        image: keyframe.message,
        receiveTime: 10n,
      });
      expect(renderable.userData.displayedFrameState).toEqual({
        image: keyframe.message,
        receiveTime: 10n,
      });

      time.advance(20);
      updateImageState.mockClear();
      await expect(
        renderable.setCompressedVideoFrames([delta], { updateImageState }),
      ).resolves.toEqual<ImageSetImageResult>({ ok: true });

      expect(decodeVideoFrame).toHaveBeenCalledTimes(2);
      expect(renderable.getDecodedImage()).toBe(keyDecodedFrame);
      expect(renderable.userData.image).toBe(keyframe.message);
      expect(renderable.userData.receiveTime).toBe(10n);
      expect(renderable.userData.latestMessageState).toEqual({
        image: delta.message,
        receiveTime: 20n,
      });
      expect(renderable.userData.displayedFrameState).toEqual({
        image: keyframe.message,
        receiveTime: 10n,
      });
      expect(updateImageState).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("keeps playback metadata for delayed decoded frames beyond the former cache window", async () => {
    const time = mockDateNow();
    try {
      const decodedFrame = new MockVideoFrame() as unknown as VideoFrame;
      const events = Array.from({ length: 130 }, (_value, index) =>
        videoFrameEvent(BigInt(index + 1) * 10n, index + 1, index === 0 ? "key" : "delta"),
      );
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];
      if (firstEvent == undefined || lastEvent == undefined) {
        throw new Error("Expected delayed playback events");
      }
      let decodeCount = 0;
      const decodeVideoFrame = jest.fn<
        Promise<DecodedVideoFrame | undefined>,
        [CompressedVideo, bigint]
      >(async (): Promise<DecodedVideoFrame | undefined> => {
        decodeCount++;
        if (decodeCount !== events.length) {
          return undefined;
        }
        return { frame: decodedFrame, originalTimestamp: 1n, receiveTime: 10n };
      });
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const updateImageState = jest.fn();

      for (const event of events.slice(0, -1)) {
        await expect(
          renderable.setCompressedVideoFrames([event], { updateImageState }),
        ).resolves.toEqual<ImageSetImageResult>({ ok: false, reason: "failed" });
        time.advance(20);
      }

      await expect(
        renderable.setCompressedVideoFrames([lastEvent], { updateImageState }),
      ).resolves.toMatchObject({ ok: true, decodedFrame: firstEvent });

      expect(renderable.getDecodedImage()).toBe(decodedFrame);
      expect(updateImageState).toHaveBeenCalledTimes(1);
      expect(updateImageState).toHaveBeenCalledWith(firstEvent);
      expect(renderable.userData.displayedFrameState).toEqual({
        image: firstEvent.message,
        receiveTime: 10n,
      });
    } finally {
      time.restore();
    }
  });

  it("closes decoded playback frames when the renderable is hidden", async () => {
    const time = mockDateNow();
    try {
      const decoded = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrame = makeDecodeVideoFrameMock([decoded]);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      renderable.visible = false;

      await expect(
        renderable.setCompressedVideoFrames([keyframe]),
      ).resolves.toEqual<ImageSetImageResult>({ ok: false, reason: "stale" });

      expect((decoded as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect(renderable.getDecodedImage()).toBeUndefined();
      expect(renderable.userData.displayedFrameState).toBeUndefined();
      expect(renderable.userData.latestMessageState).toEqual({
        image: keyframe.message,
        receiveTime: 10n,
      });
    } finally {
      time.restore();
    }
  });

  it("waits for the exact target during replay when an intermediate frame decodes first", async () => {
    const time = mockDateNow();
    try {
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const targetFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveTarget!: (result: AwaitTargetFrameResult) => void;
      const targetPromise = new Promise<AwaitTargetFrameResult>((resolve) => {
        resolveTarget = resolve;
      });
      const decoder = {
        decodeVideoFrames: jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
          async ({ requestId }) => ({
            type: "IntermediateFrame",
            requestId,
            frame: intermediateFrame,
            originalTimestamp: 1n,
            receiveTime: 10n,
          }),
        ),
        awaitTargetFrame: jest.fn(async () => await targetPromise),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const target = videoFrameEvent(20n, 2, "delta");

      const replayResult = renderable.setCompressedVideoFrames([keyframe, target], {
        decodeMode: "exact",
        allowIntermediateVideoFrame: false,
      });
      await flushPromises();

      expect(renderable.getDecodedImage()).toBeUndefined();
      expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);

      time.advance(20);
      resolveTarget({
        type: "TargetFrame",
        requestId: 1,
        frame: targetFrame,
        originalTimestamp: 2n,
        receiveTime: 20n,
      });
      await flushPromises();

      await expect(replayResult).resolves.toMatchObject({ ok: true, decodedFrame: target });
      expect(renderable.getDecodedImage()).toBe(targetFrame);
      expect(renderable.userData.image).toBe(target.message);
      expect(renderable.userData.receiveTime).toBe(20n);
      expect((targetFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("closes stale exact replay target frames without updating texture", async () => {
    const time = mockDateNow();
    try {
      const decoded = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrames = jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
        async ({ requestId }) => ({
          type: "IntermediateFrame",
          requestId,
          frame: decoded,
          originalTimestamp: 1n,
          receiveTime: 10n,
        }),
      );
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const updateImageState = jest.fn();

      await expect(
        renderable.setCompressedVideoFrames([keyframe], {
          decodeMode: "exact",
          updateImageState,
          isVideoFrameRequestCurrent: () => false,
        }),
      ).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "stale",
      });

      expect((decoded as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
      expect(renderable.getDecodedImage()).toBeUndefined();
      expect(renderable.userData.displayedFrameState).toBeUndefined();
      expect(updateImageState).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("serializes compressed video decode batches while a previous worker decode is pending", async () => {
    const time = mockDateNow();
    try {
      const firstFrame = new MockVideoFrame() as unknown as VideoFrame;
      const secondFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveFirstDecode!: (result: DecodeVideoFramesResult) => void;
      const firstDecodePromise = new Promise<DecodeVideoFramesResult>((resolve) => {
        resolveFirstDecode = resolve;
      });
      const decodeVideoFrames = jest
        .fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>()
        .mockImplementationOnce(async () => await firstDecodePromise)
        .mockResolvedValueOnce({
          type: "TargetFrame",
          requestId: 2,
          frame: secondFrame,
          originalTimestamp: 2n,
          receiveTime: 20n,
        });
      const resetVideoDecoder = jest.fn();
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder,
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const firstEvent = videoFrameEvent(10n, 1, "key");
      const secondEvent = videoFrameEvent(20n, 2, "delta");

      const firstResult = renderable.setCompressedVideoFrames([firstEvent], {
        decodeMode: "exact",
      });
      await flushPromises();

      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);

      time.advance(20);
      const secondResult = renderable.setCompressedVideoFrames([secondEvent], {
        decodeMode: "exact",
      });
      await flushPromises();

      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);
      expect(resetVideoDecoder).not.toHaveBeenCalled();

      resolveFirstDecode({
        type: "TargetFrame",
        requestId: 1,
        frame: firstFrame,
        originalTimestamp: 1n,
        receiveTime: 10n,
      });
      await flushPromises();
      await flushPromises();

      expect(decodeVideoFrames).toHaveBeenCalledTimes(2);
      expect(decodeVideoFrames.mock.calls[1]![0].frames.map((entry) => entry.receiveTime)).toEqual([
        20n,
      ]);
      await expect(firstResult).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "failed",
      });
      await expect(secondResult).resolves.toMatchObject({ ok: true, decodedFrame: secondEvent });
      expect(renderable.getDecodedImage()).toBe(secondFrame);
      expect((firstFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect((secondFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("resetForSeek aborts pending and queued compressed video decode batches", async () => {
    const time = mockDateNow();
    try {
      const lateFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveFirstDecode!: (result: DecodeVideoFramesResult) => void;
      const firstDecodePromise = new Promise<DecodeVideoFramesResult>((resolve) => {
        resolveFirstDecode = resolve;
      });
      const decodeVideoFrames = jest
        .fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>()
        .mockImplementationOnce(async () => await firstDecodePromise)
        .mockResolvedValueOnce({
          type: "TargetFrame",
          requestId: 2,
          frame: new MockVideoFrame() as unknown as VideoFrame,
          originalTimestamp: 2n,
          receiveTime: 20n,
        });
      const resetVideoDecoder = jest.fn();
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder,
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const firstEvent = videoFrameEvent(10n, 1, "key");
      const secondEvent = videoFrameEvent(20n, 2, "delta");

      const activeResult = renderable.setCompressedVideoFrames([firstEvent], {
        decodeMode: "exact",
      });
      await flushPromises();
      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);

      time.advance(20);
      const queuedResult = renderable.setCompressedVideoFrames([secondEvent], {
        decodeMode: "exact",
      });
      await flushPromises();
      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);

      renderable.resetForSeek();

      await expect(activeResult).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "failed",
      });
      await expect(queuedResult).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "failed",
      });
      expect(resetVideoDecoder).toHaveBeenCalledTimes(1);

      resolveFirstDecode({
        type: "TargetFrame",
        requestId: 1,
        frame: lateFrame,
        originalTimestamp: 1n,
        receiveTime: 10n,
      });
      await flushPromises();

      expect(decodeVideoFrames).toHaveBeenCalledTimes(1);
      expect(renderable.getDecodedImage()).toBeUndefined();
      expect((lateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
    }
  });

  it("keeps the current video frame when compressed video decode times out", async () => {
    const time = mockDateNow();
    try {
      const currentFrame = new MockVideoFrame() as unknown as VideoFrame;
      const decodeVideoFrame = makeDecodeVideoFrameMock([currentFrame, undefined]);
      const decoder = {
        decodeVideoFrame,
        decodeVideoFrames: jest.fn(),
        awaitTargetFrame: abortAwaitTargetFrame(),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const firstEvent = videoFrameEvent(10n, 1, "key");
      const secondEvent = videoFrameEvent(20n, 2, "delta");

      await expect(renderable.setCompressedVideoFrames([firstEvent])).resolves.toMatchObject({
        ok: true,
        decodedFrame: firstEvent,
      });
      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect(renderable.userData.texture?.image).toBe(currentFrame);

      time.advance(20);
      jest.clearAllMocks();
      await expect(
        renderable.setCompressedVideoFrames([secondEvent]),
      ).resolves.toEqual<ImageSetImageResult>({ ok: true });

      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect(renderable.userData.texture?.image).toBe(currentFrame);
      expect((currentFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
      expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("closes stale exact target frames without updating texture or reporting decode failure", async () => {
    const staleFrame = new MockVideoFrame() as unknown as VideoFrame;
    const onDecoded = jest.fn();
    const resetVideoDecoder = jest.fn();
    const decoder = {
      decodeVideoFrames: jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
        async ({ requestId }) => ({
          type: "TargetFrame",
          requestId,
          frame: staleFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        }),
      ),
      awaitTargetFrame: abortAwaitTargetFrame(),
      resetVideoDecoder,
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder;
    const renderable = new TestVideoBatchRenderable(decoder);
    const event = videoFrameEvent(10n, 1, "key");

    jest.clearAllMocks();
    await expect(
      renderable.setCompressedVideoFrames([event], {
        decodeMode: "exact",
        onDecoded,
        isVideoFrameRequestCurrent: () => false,
      }),
    ).resolves.toEqual<ImageSetImageResult>({
      ok: false,
      reason: "stale",
    });

    expect(renderable.getDecodedImage()).toBeUndefined();
    expect(renderable.userData.texture).toBeUndefined();
    expect((staleFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
    expect(onDecoded).not.toHaveBeenCalled();
    expect(mockRenderer.queueAnimationFrame).not.toHaveBeenCalled();
    expect(resetVideoDecoder).not.toHaveBeenCalled();
  });

  it("replaces an intermediate video frame when the target frame arrives later", async () => {
    const time = mockDateNow();
    try {
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const targetFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveTarget!: (result: AwaitTargetFrameResult) => void;
      const targetPromise = new Promise<AwaitTargetFrameResult>((resolve) => {
        resolveTarget = resolve;
      });
      const decoder = {
        decodeVideoFrames: jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
          async () => ({
            type: "IntermediateFrame",
            requestId: 1,
            frame: intermediateFrame,
            originalTimestamp: 1n,
            receiveTime: 10n,
          }),
        ),
        awaitTargetFrame: jest.fn(async () => await targetPromise),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const keyframe = videoFrameEvent(10n, 1, "key");
      const target = videoFrameEvent(20n, 2, "delta");

      void renderable.setCompressedVideoFrames([keyframe, target], { decodeMode: "exact" });

      await flushPromises();
      await flushPromises();
      expect(renderable.getDecodedImage()).toBe(intermediateFrame);

      time.advance(20);
      resolveTarget({
        type: "TargetFrame",
        requestId: 1,
        frame: targetFrame,
        originalTimestamp: 2n,
        receiveTime: 20n,
      });
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(targetFrame);
      expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect((targetFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("keeps the current video frame during seek replay until the target frame arrives", async () => {
    const time = mockDateNow();
    try {
      const currentFrame = new MockVideoFrame() as unknown as VideoFrame;
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const targetFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveTarget!: (result: AwaitTargetFrameResult) => void;
      const targetPromise = new Promise<AwaitTargetFrameResult>((resolve) => {
        resolveTarget = resolve;
      });
      const decodeVideoFrames = jest
        .fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>()
        .mockResolvedValueOnce({
          type: "TargetFrame",
          requestId: 1,
          frame: currentFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        })
        .mockResolvedValueOnce({
          type: "IntermediateFrame",
          requestId: 2,
          frame: intermediateFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        });
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: jest.fn(async () => await targetPromise),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);

      await expect(
        renderable.setCompressedVideoFrames([videoFrameEvent(10n, 1, "key")], {
          decodeMode: "exact",
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect(renderable.userData.texture?.image).toBe(currentFrame);

      time.advance(20);
      const replayResult = renderable.setCompressedVideoFrames(
        [videoFrameEvent(10n, 1, "key"), videoFrameEvent(20n, 2, "delta")],
        { allowIntermediateVideoFrame: false },
      );
      await flushPromises();
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect(renderable.userData.texture?.image).toBe(currentFrame);
      expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);

      time.advance(20);
      resolveTarget({
        type: "TargetFrame",
        requestId: 2,
        frame: targetFrame,
        originalTimestamp: 2n,
        receiveTime: 20n,
      });

      await expect(replayResult).resolves.toMatchObject<ImageSetImageResult>({ ok: true });
      expect(renderable.getDecodedImage()).toBe(targetFrame);
      expect((currentFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect((targetFrame as unknown as MockVideoFrame).close).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
  });

  it("resolves failed seek replay when the awaited target video frame is aborted", async () => {
    const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
    const decoder = {
      decodeVideoFrames: jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
        async ({ requestId }) => ({
          type: "IntermediateFrame",
          requestId,
          frame: intermediateFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        }),
      ),
      awaitTargetFrame: jest.fn(
        async ({ requestId }): Promise<AwaitTargetFrameResult> => ({ type: "Aborted", requestId }),
      ),
      resetVideoDecoder: jest.fn(),
      terminate: jest.fn(),
    } as unknown as WorkerImageDecoder;
    const renderable = new TestVideoBatchRenderable(decoder);

    await expect(
      renderable.setCompressedVideoFrames(
        [videoFrameEvent(10n, 1, "key"), videoFrameEvent(20n, 2, "delta")],
        { allowIntermediateVideoFrame: false },
      ),
    ).resolves.toEqual<ImageSetImageResult>({ ok: false, reason: "failed" });
    expect(renderable.getDecodedImage()).toBeUndefined();
    expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
  });

  it("times out no-intermediate seek replay when the awaited target video frame never arrives", async () => {
    jest.useFakeTimers();
    try {
      const currentFrame = new MockVideoFrame() as unknown as VideoFrame;
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const targetPromise = new Promise<AwaitTargetFrameResult>(() => {});
      const decodeVideoFrames = jest
        .fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>()
        .mockResolvedValueOnce({
          type: "TargetFrame",
          requestId: 1,
          frame: currentFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        })
        .mockResolvedValueOnce({
          type: "IntermediateFrame",
          requestId: 2,
          frame: intermediateFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        });
      const resetVideoDecoder = jest.fn();
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: jest.fn(async () => await targetPromise),
        resetVideoDecoder,
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);

      await expect(
        renderable.setCompressedVideoFrames([videoFrameEvent(10n, 1, "key")], {
          decodeMode: "exact",
        }),
      ).resolves.toMatchObject({ ok: true });

      const replayResult = renderable.setCompressedVideoFrames(
        [videoFrameEvent(10n, 1, "key"), videoFrameEvent(20n, 2, "delta")],
        { allowIntermediateVideoFrame: false, targetFrameTimeoutMs: 25 },
      );
      await flushPromises();
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(25);
      await flushPromises();

      await expect(
        race([replayResult, Promise.resolve("pending")]),
      ).resolves.toEqual<ImageSetImageResult>({ ok: false, reason: "failed" });
      expect(renderable.getDecodedImage()).toBe(currentFrame);
      expect(resetVideoDecoder).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolves stale without resetting the decoder when a superseded no-intermediate target waits", async () => {
    jest.useFakeTimers();
    try {
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const targetPromise = new Promise<AwaitTargetFrameResult>(() => {});
      const decodeVideoFrames = jest.fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>(
        async ({ requestId }) => ({
          type: "IntermediateFrame",
          requestId,
          frame: intermediateFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        }),
      );
      const resetVideoDecoder = jest.fn();
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: jest.fn(async () => await targetPromise),
        resetVideoDecoder,
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      let isCurrent = true;

      const replayResult = renderable.setCompressedVideoFrames(
        [videoFrameEvent(10n, 1, "key"), videoFrameEvent(20n, 2, "delta")],
        {
          allowIntermediateVideoFrame: false,
          isVideoFrameRequestCurrent: () => isCurrent,
          targetFrameTimeoutMs: 25,
        },
      );
      await flushPromises();
      await flushPromises();

      isCurrent = false;
      await jest.advanceTimersByTimeAsync(25);
      await flushPromises();

      await expect(replayResult).resolves.toEqual<ImageSetImageResult>({
        ok: false,
        reason: "stale",
      });
      expect(renderable.getDecodedImage()).toBeUndefined();
      expect((intermediateFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
      expect(resetVideoDecoder).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("closes a late target frame when a newer image has already been requested", async () => {
    const time = mockDateNow();
    try {
      const intermediateFrame = new MockVideoFrame() as unknown as VideoFrame;
      const staleTargetFrame = new MockVideoFrame() as unknown as VideoFrame;
      const latestFrame = new MockVideoFrame() as unknown as VideoFrame;
      let resolveStaleTarget!: (result: AwaitTargetFrameResult) => void;
      const staleTargetPromise = new Promise<AwaitTargetFrameResult>((resolve) => {
        resolveStaleTarget = resolve;
      });
      const decodeVideoFrames = jest
        .fn<Promise<DecodeVideoFramesResult>, [DecodeVideoFramesArgs]>()
        .mockResolvedValueOnce({
          type: "IntermediateFrame",
          requestId: 1,
          frame: intermediateFrame,
          originalTimestamp: 1n,
          receiveTime: 10n,
        })
        .mockResolvedValueOnce({
          type: "TargetFrame",
          requestId: 2,
          frame: latestFrame,
          originalTimestamp: 3n,
          receiveTime: 30n,
        });
      const decoder = {
        decodeVideoFrames,
        awaitTargetFrame: jest.fn(async () => await staleTargetPromise),
        resetVideoDecoder: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WorkerImageDecoder;
      const renderable = new TestVideoBatchRenderable(decoder);
      const firstEvent = videoFrameEvent(10n, 1, "key");
      const staleEvent = videoFrameEvent(20n, 2, "delta");
      const latestEvent = videoFrameEvent(30n, 3, "key");

      void renderable.setCompressedVideoFrames([firstEvent, staleEvent], { decodeMode: "exact" });
      await flushPromises();
      await flushPromises();
      expect(renderable.getDecodedImage()).toBe(intermediateFrame);

      time.advance(20);
      void renderable.setCompressedVideoFrames([latestEvent], { decodeMode: "exact" });
      await flushPromises();
      await flushPromises();
      expect(renderable.getDecodedImage()).toBe(latestFrame);

      resolveStaleTarget({
        type: "TargetFrame",
        requestId: 1,
        frame: staleTargetFrame,
        originalTimestamp: 2n,
        receiveTime: 20n,
      });
      await flushPromises();

      expect(renderable.getDecodedImage()).toBe(latestFrame);
      expect((staleTargetFrame as unknown as MockVideoFrame).close).toHaveBeenCalledTimes(1);
    } finally {
      time.restore();
    }
  });

  it("should close the previous ImageBitmap when replacing it with the same dimensions", async () => {
    const time = mockDateNow();
    try {
      const bitmap1 = await createImageBitmap(new ImageData(640, 480));
      const bitmap2 = await createImageBitmap(new ImageData(640, 480));
      const closeBitmap1 = jest.spyOn(bitmap1, "close");
      const closeBitmap2 = jest.spyOn(bitmap2, "close");
      const renderable = new TestImageRenderable([bitmap1, bitmap2]);

      void renderable.setImage(sampleImage);
      await flushPromises();

      time.advance(20);
      void renderable.setImage({
        ...sampleImage,
        header: { frame_id: "camera", stamp: { sec: 0, nsec: 2 } },
      });
      await flushPromises();

      expect(renderable.userData.texture?.image).toBe(bitmap2);
      expect(closeBitmap1).toHaveBeenCalledTimes(1);
      expect(closeBitmap2).not.toHaveBeenCalled();
    } finally {
      time.restore();
    }
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
