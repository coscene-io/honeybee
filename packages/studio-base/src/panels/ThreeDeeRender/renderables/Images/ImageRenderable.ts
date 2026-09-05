// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import * as THREE from "three";
import { assert } from "ts-essentials";

import { PinholeCameraModel } from "@foxglove/den/image";
import Logger from "@foxglove/log";
import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import { IRenderer } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import { BaseUserData, Renderable } from "@foxglove/studio-base/panels/ThreeDeeRender/Renderable";
import { stringToRgba } from "@foxglove/studio-base/panels/ThreeDeeRender/color";
import {
  clampBrightness,
  clampContrast,
} from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/ImageMode/utils";
import type { DecodeVideoFramesResult } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { WorkerImageDecoder } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { projectPixel } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/projections";
import {
  getRemoteVideoFrame,
  isRemoteVideoFrameReference,
} from "@foxglove/studio-base/players/IterablePlayer/Mp4/RemoteVideoFrameRegistry";
import { RosValue } from "@foxglove/studio-base/players/types";

import { AnyImage, CompressedVideo } from "./ImageTypes";
import { decodeCompressedImageToBitmap, isVideoKeyframe } from "./decodeImage";
import { CameraInfo } from "../../ros";
import {
  DECODE_IMAGE_ERR_KEY,
  FRAGMENT_SHADER,
  IMAGE_TOPIC_PATH,
  INITIAL_BRIGHTNESS,
  INITIAL_CONTRAST,
  VERTEX_SHADER,
} from "../ImageMode/constants";
import { ColorModeSettings } from "../colorMode";

const log = Logger.getLogger(__filename);
export interface ImageRenderableSettings extends Partial<ColorModeSettings> {
  visible: boolean;
  frameLocked?: boolean;
  cameraInfoTopic: string | undefined;
  distance: number;
  planarProjectionFactor: number;
  color: string;
  brightness: number;
  contrast: number;
}

const DEFAULT_DISTANCE = 1;
const DEFAULT_PLANAR_PROJECTION_FACTOR = 0;
export const IMAGE_RENDERABLE_DEFAULT_SETTINGS: ImageRenderableSettings = {
  visible: false,
  frameLocked: true,
  cameraInfoTopic: undefined,
  distance: DEFAULT_DISTANCE,
  planarProjectionFactor: DEFAULT_PLANAR_PROJECTION_FACTOR,
  color: "#ffffff",
  brightness: INITIAL_BRIGHTNESS,
  contrast: INITIAL_CONTRAST,
};

const VIDEO_FORMATS = new Set(["h264", "h265"]);
const DEFAULT_VIDEO_TARGET_FRAME_TIMEOUT_MS = 30;
const DEFAULT_VIDEO_ANY_FRAME_TIMEOUT_MS = 100;
const MAX_COMPRESSED_VIDEO_FRAME_EVENT_CACHE_SIZE = 512;

type DecodedImageResource = ImageBitmap | ImageData | VideoFrame;
type DecodedImageResult =
  | {
      image?: DecodedImageResource;
      decodedFrame?: CompressedVideoFrameEvent;
      ok: true;
    }
  | {
      image?: DecodedImageResource;
      decodedFrame?: CompressedVideoFrameEvent;
      ok: false;
      reason: "stale";
    }
  | {
      image?: DecodedImageResource;
      decodedFrame?: CompressedVideoFrameEvent;
      ok: false;
      reason: "failed" | "timeout" | "frame-out-of-order";
    };

export type ImageSetImageResult =
  | {
      ok: true;
      decodedFrame?: CompressedVideoFrameEvent;
    }
  | {
      ok: false;
      reason: "stale";
      decodedFrame?: CompressedVideoFrameEvent;
    }
  | {
      ok: false;
      reason: "failed" | "timeout" | "frame-out-of-order";
      decodedFrame?: CompressedVideoFrameEvent;
    };

export type CompressedVideoFrameEvent = MessageEvent<CompressedVideo>;

export type SetCompressedVideoFramesOptions = {
  resizeWidth?: number;
  onDecoded?: () => void;
  updateLatestMessageState?: (event: CompressedVideoFrameEvent) => void;
  updateImageState?: (event: CompressedVideoFrameEvent) => void;
  onLateTargetFrameSettled?: (result: ImageSetImageResult) => void;
  targetFrameTimeoutMs?: number;
  anyFrameTimeoutMs?: number;
  retainLateTarget?: boolean;
  canDisplayFrame?: (event: CompressedVideoFrameEvent) => boolean;
  isVideoFrameRequestCurrent?: () => boolean;
};

type PendingDecodedImage = {
  seq: number;
  generation: number;
  result: DecodedImageResource;
  decodedFrame?: CompressedVideoFrameEvent;
  event?: { message: AnyImage; receiveTime: MessageEvent["receiveTime"] };
  isRequestCurrent?: () => boolean;
  onDecoded?: () => void;
  canDisplay?: () => boolean;
};

type PendingImage = {
  image: AnyImage;
  resizeWidth?: number;
  onDecoded?: () => void;
  event: { message: AnyImage; receiveTime: MessageEvent["receiveTime"] };
  resolve: (result: ImageSetImageResult) => void;
};

type PendingVideoDecode = {
  seq: number;
  frame: CompressedVideo;
  messageEvent: CompressedVideoFrameEvent | undefined;
  receiveTime: bigint;
  onDecoded: (() => void) | undefined;
  updateImageState: ((event: CompressedVideoFrameEvent) => void) | undefined;
  canDisplayFrame?: (event: CompressedVideoFrameEvent) => boolean;
  settled: boolean;
  resolve: (result: DecodedImageResult) => void;
};

type VideoDecodeBatchOptions = Pick<
  SetCompressedVideoFramesOptions,
  | "targetFrameTimeoutMs"
  | "anyFrameTimeoutMs"
  | "retainLateTarget"
  | "isVideoFrameRequestCurrent"
  | "onLateTargetFrameSettled"
>;

type VideoDecodeBatch = {
  decoder: WorkerImageDecoder;
  entries: PendingVideoDecode[];
  options: VideoDecodeBatchOptions;
};

export type ImageUserData = BaseUserData & {
  topic: string;
  settings: ImageRenderableSettings;
  firstMessageTime: bigint | undefined;
  cameraInfo: CameraInfo | undefined;
  cameraModel: PinholeCameraModel | undefined;
  image: AnyImage | undefined;
  latestMessageState?: { image: AnyImage; receiveTime: bigint };
  displayedFrameState?: { image: AnyImage; receiveTime: bigint };
  texture: THREE.Texture | undefined;
  // The material should use ShaderMaterial so we can use custom shaders to apply effects like brightness and contrast
  material: THREE.ShaderMaterial | undefined;
  geometry: THREE.PlaneGeometry | undefined;
  mesh: THREE.Mesh | undefined;
};

export class ImageRenderable extends Renderable<ImageUserData> {
  // Make sure that everything is build the first time we render
  // set when camera info or image changes
  #geometryNeedsUpdate = true;
  // set when geometry or material reference changes
  #meshNeedsUpdate = true;
  // set when image changes
  #textureNeedsUpdate = true;
  // set when material or texture changes
  #materialNeedsUpdate = true;

  #renderBehindScene: boolean = false;

  #isUpdating = false;

  #decodedImage?: DecodedImageResource;
  protected decoder?: WorkerImageDecoder;
  #receivedImageSequenceNumber = 0;
  #displayedImageSequenceNumber = 0;
  #imageGeneration = 0;
  #activeImage = false;
  #pendingImage: PendingImage | undefined;
  #imageMicrotask = false;
  #allowStoppedImage = true;
  #latestImageTarget: PendingImage["event"] | undefined;
  #pendingDecodedImage: PendingDecodedImage | undefined;
  #videoDecodeRequestId = 0;
  #lateTargetRequestId: number | undefined;
  #activeVideoDecodeBatch: PendingVideoDecode[] | undefined;
  #videoDecoderResetPromise: Promise<void> | undefined;
  #compressedVideoFrameEventsByReceiveTime = new Map<bigint, CompressedVideoFrameEvent>();

  #disposed = false;

  public constructor(topicName: string, renderer: IRenderer, userData: ImageUserData) {
    super(topicName, renderer, userData);
    this.#allowStoppedImage = renderer.getPlaybackIsPlaying?.() === false;
    renderer.on("startFrame", this.#commitCandidate);
  }

  protected isDisposed(): boolean {
    return this.#disposed;
  }

  public getDecodedImage(): ImageBitmap | ImageData | VideoFrame | undefined {
    return this.#decodedImage;
  }

  public override dispose(): void {
    this.#disposed = true;
    this.renderer.off("startFrame", this.#commitCandidate);
    this.#pendingImage?.resolve({ ok: false, reason: "stale" });
    this.#pendingImage = undefined;
    const textureImage = this.userData.texture?.image;
    closeDecodedImageResource(textureImage);
    if (this.#decodedImage !== textureImage) {
      closeDecodedImageResource(this.#decodedImage);
    }
    this.#clearPendingDecodedImage(this.#decodedImage);
    this.#cancelPendingVideoDecodes();
    this.userData.texture?.dispose();
    this.userData.material?.dispose();
    this.userData.geometry?.dispose();
    this.decoder?.terminate();
    super.dispose();
  }

  /** Invalidate pending image work without starting a worker RPC. */
  public invalidateImage(): void {
    this.#imageGeneration++;
    this.userData.displayedFrameState = undefined;
    this.#clearPendingDecodedImage();
    this.#pendingImage?.resolve({ ok: false, reason: "stale" });
    this.#pendingImage = undefined;
    this.#allowStoppedImage = true;
  }

  public resetForSeek(): void {
    this.invalidateImage();
    this.#lateTargetRequestId = undefined;
    this.#videoDecodeRequestId++;
    this.#cancelPendingVideoDecodes(this.#staleVideoFrameResult());
    this.#compressedVideoFrameEventsByReceiveTime.clear();
    if (this.decoder != undefined) {
      const resetPromise = this.decoder.resetVideoDecoder().catch((error: unknown) => {
        log.error(error);
      });
      this.#videoDecoderResetPromise = resetPromise;
      void resetPromise.finally(() => {
        if (this.#videoDecoderResetPromise === resetPromise) {
          this.#videoDecoderResetPromise = undefined;
        }
      });
    }
  }

  public updateHeaderInfo(): void {
    assert(this.userData.image, "updateHeaderInfo called without image");

    // If there is camera info, the frameId comes from the camera info since the user may have
    // selected camera info with a different frame than our image frame.
    //
    // If there is no camera info, we fall back to the image's frame
    const image = this.userData.image;
    const rawFrameId =
      this.userData.cameraInfo?.header.frame_id ??
      ("header" in image ? image.header.frame_id : image.frame_id);
    this.userData.frameId =
      typeof rawFrameId === "string" ? this.renderer.normalizeFrameId(rawFrameId) : rawFrameId;
    this.userData.messageTime = toNanoSec("header" in image ? image.header.stamp : image.timestamp);
  }

  public override details(): Record<string, RosValue> {
    return { image: this.userData.image, camera_info: this.userData.cameraInfo };
  }

  public setRenderBehindScene(): void {
    this.#renderBehindScene = true;
    this.#materialNeedsUpdate = true;
    this.#meshNeedsUpdate = true;
  }

  // Renderable should only need to care about the model
  public setCameraModel(cameraModel: PinholeCameraModel): void {
    this.#geometryNeedsUpdate ||= this.userData.cameraModel !== cameraModel;
    this.userData.cameraModel = cameraModel;
  }

  public setSettings(newSettings: ImageRenderableSettings): void {
    const prevSettings = this.userData.settings;
    if (prevSettings.cameraInfoTopic !== newSettings.cameraInfoTopic) {
      // clear mesh since it is no longer showing userData accurately
      if (this.userData.mesh != undefined) {
        this.remove(this.userData.mesh);
      }
      this.userData.mesh = undefined;
      this.#geometryNeedsUpdate = true;
    }
    if (
      prevSettings.distance !== newSettings.distance ||
      newSettings.planarProjectionFactor !== prevSettings.planarProjectionFactor
    ) {
      this.#geometryNeedsUpdate = true;
    }

    if (
      newSettings.color !== prevSettings.color ||
      prevSettings.brightness !== newSettings.brightness ||
      prevSettings.contrast !== newSettings.contrast
    ) {
      this.#materialNeedsUpdate = true;
    }

    if (
      prevSettings.colorMode !== newSettings.colorMode ||
      prevSettings.flatColor !== newSettings.flatColor ||
      !_.isEqual(prevSettings.gradient, newSettings.gradient) ||
      prevSettings.colorMap !== newSettings.colorMap ||
      prevSettings.minValue !== newSettings.minValue ||
      prevSettings.maxValue !== newSettings.maxValue
    ) {
      this.userData.settings = newSettings;
      this.invalidateImage();
      this.#materialNeedsUpdate = true;
      // Decode the current image again, which takes into account the new options
      const image = this.userData.image;
      if (
        image != undefined &&
        !("format" in image && typeof image.format === "string" && VIDEO_FORMATS.has(image.format))
      ) {
        void this.setImage(image);
      }
      return;
    }

    this.userData.settings = newSettings;
  }

  public async setImage(
    image: AnyImage,
    resizeWidth?: number,
    onDecoded?: () => void,
    messageEvent?: { receiveTime: MessageEvent["receiveTime"] },
  ): Promise<ImageSetImageResult> {
    const event = {
      message: image,
      receiveTime: messageEvent?.receiveTime ?? fromNanoSec(this.userData.receiveTime),
    };
    this.#latestImageTarget = event;
    this.#pendingImage?.resolve({ ok: false, reason: "stale" });
    const result = new Promise<ImageSetImageResult>((resolve) => {
      this.#pendingImage = { image, resizeWidth, onDecoded, event, resolve };
    });
    this.#scheduleImage();
    return await result;
  }

  #scheduleImage(): void {
    if (this.#imageMicrotask || this.#activeImage || this.#disposed) {
      return;
    }
    this.#imageMicrotask = true;
    queueMicrotask(() => {
      this.#imageMicrotask = false;
      const pending = this.#pendingImage;
      this.#pendingImage = undefined;
      if (pending == undefined || this.#disposed) {
        return;
      }
      if (this.renderer.isPlaybackStopped() && !this.#allowStoppedImage) {
        pending.resolve({ ok: false, reason: "stale" });
        return;
      }
      this.#allowStoppedImage = false;
      this.#activeImage = true;
      const generation = this.#imageGeneration;
      const seq = ++this.#receivedImageSequenceNumber;
      void this.decodeImageWithResult(pending.image, pending.resizeWidth)
        .then((decoded) => {
          this.#handleDecodedImage(
            seq,
            decoded,
            () => {
              pending.onDecoded?.();
            },
            pending.resolve,
            () =>
              generation === this.#imageGeneration &&
              (!this.renderer.isPlaybackStopped() || this.#latestImageTarget === pending.event),
            pending.event,
          );
        })
        .catch((error: unknown) => {
          log.error(error);
          if (!this.#disposed && generation === this.#imageGeneration) {
            this.addError(DECODE_IMAGE_ERR_KEY, `Error decoding image: ${String(error)}`);
          }
          pending.resolve({ ok: false, reason: "failed" });
        })
        .finally(() => {
          this.#activeImage = false;
          this.#scheduleImage();
        });
    });
  }

  public async setCompressedVideoFrames(
    frames: readonly CompressedVideoFrameEvent[],
    options: SetCompressedVideoFramesOptions = {},
  ): Promise<ImageSetImageResult> {
    const targetFrame = frames[frames.length - 1];
    if (targetFrame == undefined) {
      return { ok: false, reason: "failed" };
    }

    for (const frame of frames) {
      this.#recordCompressedVideoFrameEvent(frame);
    }
    this.#recordLatestCompressedVideoMessage(targetFrame);
    options.updateLatestMessageState?.(targetFrame);

    if (!VIDEO_FORMATS.has(targetFrame.message.format)) {
      const result = await this.setImage(
        targetFrame.message,
        options.resizeWidth,
        options.onDecoded,
      );
      if (result.ok) {
        options.updateImageState?.(targetFrame);
      }
      return result;
    }

    const seq = ++this.#receivedImageSequenceNumber;
    const decoder = (this.decoder ??= new WorkerImageDecoder());
    const decodePromise = this.#decodeCompressedVideoFrames(
      decoder,
      frames,
      seq,
      options.onDecoded,
      options,
    );

    return await new Promise<ImageSetImageResult>((resolve) => {
      decodePromise
        .then((result) => {
          this.#handleDecodedImage(
            seq,
            result,
            () => {
              if (result.decodedFrame != undefined) {
                options.updateImageState?.(result.decodedFrame);
              }
              options.onDecoded?.();
            },
            resolve,
            options.isVideoFrameRequestCurrent,
            undefined,
            result.decodedFrame != undefined
              ? () => options.canDisplayFrame?.(result.decodedFrame!) !== false
              : undefined,
          );
        })
        .catch((err: unknown) => {
          log.error(err);
          if (this.isDisposed()) {
            resolve({ ok: false, reason: "failed" });
            return;
          }
          this.addError(DECODE_IMAGE_ERR_KEY, `Error decoding image: ${(err as Error).message}`);
          resolve({ ok: false, reason: "failed" });
        });
    });
  }

  #handleDecodedImage(
    seq: number,
    decoded: DecodedImageResult,
    onDecoded: (() => void) | undefined,
    resolve: (result: ImageSetImageResult) => void,
    isRequestCurrent?: () => boolean,
    event?: PendingDecodedImage["event"],
    canDisplay?: () => boolean,
  ): void {
    if (!decoded.ok || decoded.image == undefined) {
      if (decoded.image != undefined) {
        this.#closeDecodedImageIfUnused(decoded.image);
      }
      resolve(imageSetResult(decoded));
      return;
    }
    if (this.#disposed || isRequestCurrent?.() === false) {
      this.#closeDecodedImageIfUnused(decoded.image);
      resolve({ ok: false, reason: "stale" });
      return;
    }
    this.#clearPendingDecodedImage(decoded.image);
    this.#pendingDecodedImage = {
      seq,
      generation: this.#imageGeneration,
      result: decoded.image,
      decodedFrame: decoded.decodedFrame,
      event: decoded.decodedFrame ?? event,
      isRequestCurrent,
      onDecoded,
      canDisplay,
    };
    this.renderer.queueAnimationFrame();
    // Decode completion releases the controller, not the next GL render.
    resolve(imageSetResult(decoded));
  }

  #commitCandidate = (): void => {
    if (this.renderer.isPlaybackStopped() && !this.#allowStoppedImage) {
      this.#pendingImage?.resolve({ ok: false, reason: "stale" });
      this.#pendingImage = undefined;
    }
    const candidate = this.#pendingDecodedImage;
    if (candidate == undefined) {
      return;
    }
    this.#pendingDecodedImage = undefined;
    const receiveTime =
      candidate.event != undefined ? toNanoSec(candidate.event.receiveTime) : undefined;
    if (
      !this.#canUpdateTexture() ||
      candidate.generation !== this.#imageGeneration ||
      candidate.isRequestCurrent?.() === false ||
      candidate.canDisplay?.() === false ||
      candidate.seq < this.#displayedImageSequenceNumber ||
      (receiveTime != undefined &&
        (receiveTime > this.renderer.currentTime ||
          (this.userData.displayedFrameState != undefined &&
            receiveTime < this.userData.displayedFrameState.receiveTime)))
    ) {
      this.#closeDecodedImageIfUnused(candidate.result);
      return;
    }
    this.#displayedImageSequenceNumber = candidate.seq;
    this.#decodedImage = candidate.result;
    this.#textureNeedsUpdate = true;
    if (candidate.event != undefined && receiveTime != undefined) {
      this.userData.image = candidate.event.message;
      this.userData.receiveTime = receiveTime;
      this.userData.displayedFrameState = { image: candidate.event.message, receiveTime };
    }
    this.update();
    candidate.onDecoded?.();
    this.removeError(DECODE_IMAGE_ERR_KEY);
  };

  #clearPendingDecodedImage(keep?: DecodedImageResource): void {
    const pending = this.#pendingDecodedImage;
    this.#pendingDecodedImage = undefined;
    if (pending != undefined && pending.result !== keep) {
      this.#closeDecodedImageIfUnused(pending.result);
    }
  }

  #recordLatestCompressedVideoMessage(frameEvent: CompressedVideoFrameEvent): void {
    const receiveTime = toNanoSec(frameEvent.receiveTime);
    this.userData.latestMessageState = { image: frameEvent.message, receiveTime };
  }

  #recordCompressedVideoFrameEvent(frameEvent: CompressedVideoFrameEvent): void {
    const receiveTime = toNanoSec(frameEvent.receiveTime);
    if (VIDEO_FORMATS.has(frameEvent.message.format)) {
      this.#compressedVideoFrameEventsByReceiveTime.set(receiveTime, frameEvent);
      this.#pruneCompressedVideoFrameEventCache();
    }
  }

  #pruneCompressedVideoFrameEventCache(): void {
    while (
      this.#compressedVideoFrameEventsByReceiveTime.size >
      MAX_COMPRESSED_VIDEO_FRAME_EVENT_CACHE_SIZE
    ) {
      let oldestReceiveTime: bigint | undefined;
      for (const receiveTime of this.#compressedVideoFrameEventsByReceiveTime.keys()) {
        if (oldestReceiveTime == undefined || receiveTime < oldestReceiveTime) {
          oldestReceiveTime = receiveTime;
        }
      }
      if (oldestReceiveTime == undefined) {
        return;
      }
      this.#compressedVideoFrameEventsByReceiveTime.delete(oldestReceiveTime);
    }
  }

  #compressedVideoFrameEventForDecodedFrame(decodedFrame: {
    originalTimestamp: bigint;
    receiveTime: bigint;
  }): CompressedVideoFrameEvent | undefined {
    const frameEvent = this.#compressedVideoFrameEventsByReceiveTime.get(decodedFrame.receiveTime);
    if (frameEvent != undefined) {
      for (const receiveTime of this.#compressedVideoFrameEventsByReceiveTime.keys()) {
        if (receiveTime > decodedFrame.receiveTime) {
          continue;
        }
        this.#compressedVideoFrameEventsByReceiveTime.delete(receiveTime);
      }
    }
    return frameEvent;
  }

  #canUpdateTexture(): boolean {
    return (
      !this.isDisposed() &&
      this.visible &&
      (typeof document === "undefined" || document.visibilityState !== "hidden")
    );
  }

  #closeDecodedImageIfUnused(result: DecodedImageResource): void {
    if (result !== this.#decodedImage) {
      closeDecodedImageResource(result);
    }
  }

  protected async decodeImage(
    image: AnyImage,
    resizeWidth?: number,
  ): Promise<ImageBitmap | ImageData | VideoFrame> {
    const result = await this.decodeImageWithResult(image, resizeWidth);
    if (result.image == undefined) {
      throw new Error("Image decode did not produce an image");
    }
    return result.image;
  }

  protected async decodeImageWithResult(
    image: AnyImage,
    resizeWidth?: number,
  ): Promise<DecodedImageResult> {
    if (isRemoteVideoFrameReference(image)) {
      return { image: await getRemoteVideoFrame(image), ok: true };
    }
    if ("format" in image) {
      if (!VIDEO_FORMATS.has(image.format)) {
        return { image: await decodeCompressedImageToBitmap(image, resizeWidth), ok: true };
      } else {
        const frameMsg = image as CompressedVideo;

        if (frameMsg.data.byteLength === 0) {
          const error = "Empty video frame";
          log.error(error);
          return { ok: false, reason: "failed" };
        }

        const decoder = (this.decoder ??= new WorkerImageDecoder());

        const frameEvent: CompressedVideoFrameEvent = {
          topic: this.userData.topic,
          schemaName: "foxglove.CompressedVideo",
          receiveTime: fromNanoSec(this.userData.receiveTime),
          message: frameMsg,
          sizeInBytes: frameMsg.data.byteLength,
        };
        this.#recordCompressedVideoFrameEvent(frameEvent);
        return await this.#decodeCompressedVideoFrames(
          decoder,
          [frameEvent],
          this.#receivedImageSequenceNumber,
          undefined,
          {
            targetFrameTimeoutMs: DEFAULT_VIDEO_TARGET_FRAME_TIMEOUT_MS,
            anyFrameTimeoutMs: isVideoKeyframe(frameMsg)
              ? DEFAULT_VIDEO_ANY_FRAME_TIMEOUT_MS
              : undefined,
          },
        );
      }
    }
    return {
      image: await (this.decoder ??= new WorkerImageDecoder()).decode(
        image,
        this.userData.settings,
      ),
      ok: true,
    };
  }

  async #decodeCompressedVideoFrames(
    decoder: WorkerImageDecoder,
    frames: readonly CompressedVideoFrameEvent[],
    seq: number,
    onDecoded: (() => void) | undefined,
    options: SetCompressedVideoFramesOptions,
  ): Promise<DecodedImageResult> {
    let resolveTarget!: (result: DecodedImageResult) => void;
    const targetResult = new Promise<DecodedImageResult>((resolve) => {
      resolveTarget = resolve;
    });
    const targetIndex = frames.length - 1;
    const entries: PendingVideoDecode[] = frames.map((frame, index) => ({
      seq: index === targetIndex ? seq : 0,
      frame: frame.message,
      messageEvent: frame,
      receiveTime: toNanoSec(frame.receiveTime),
      onDecoded: index === targetIndex ? onDecoded : undefined,
      updateImageState: index === targetIndex ? options.updateImageState : undefined,
      canDisplayFrame: options.canDisplayFrame,
      settled: false,
      resolve: index === targetIndex ? resolveTarget : () => {},
    }));

    while (this.#videoDecoderResetPromise != undefined) {
      await this.#videoDecoderResetPromise;
    }

    if (this.isDisposed()) {
      for (const entry of entries) {
        this.#settleVideoDecode(entry, this.#failedVideoFrameResult());
      }
    } else if (
      options.isVideoFrameRequestCurrent?.() === false ||
      this.#activeVideoDecodeBatch != undefined
    ) {
      for (const entry of entries) {
        this.#settleVideoDecode(entry, this.#staleVideoFrameResult());
      }
    } else {
      this.#startVideoDecodeBatch({ decoder, entries, options });
    }

    return await targetResult;
  }

  #startVideoDecodeBatch(batch: VideoDecodeBatch): void {
    const { decoder, entries, options } = batch;
    this.#activeVideoDecodeBatch = entries;
    const runBatch = async () => {
      try {
        if (entries.every((entry) => entry.settled)) {
          return;
        }
        await this.#runVideoDecodeBatch(decoder, entries, options);
      } finally {
        if (this.#activeVideoDecodeBatch === entries) {
          this.#activeVideoDecodeBatch = undefined;
        }
      }
    };
    void runBatch();
  }

  async #runVideoDecodeBatch(
    decoder: WorkerImageDecoder,
    entries: PendingVideoDecode[],
    options: VideoDecodeBatchOptions = {},
  ): Promise<void> {
    const requestId = ++this.#videoDecodeRequestId;
    let result: DecodeVideoFramesResult;
    try {
      result = await decoder.decodeVideoFrames({
        requestId,
        frames: entries.map((entry) => ({ frame: entry.frame, receiveTime: entry.receiveTime })),
        targetFrameTimeoutMs: options.targetFrameTimeoutMs ?? DEFAULT_VIDEO_TARGET_FRAME_TIMEOUT_MS,
        anyFrameTimeoutMs: options.anyFrameTimeoutMs,
        retainLateTarget: options.retainLateTarget === true,
      });
    } catch (error) {
      log.error(error);
      const staleResult = this.#staleVideoFrameResultIfRequestIsNotCurrent(options);
      for (const entry of entries) {
        this.#settleVideoDecode(entry, staleResult ?? this.#failedVideoFrameResult());
      }
      return;
    }

    if (this.isDisposed() || result.requestId !== this.#videoDecodeRequestId) {
      closeDecodeResultFrame(result);
      const staleResult = this.#staleVideoFrameResultIfRequestIsNotCurrent(options);
      for (const entry of entries) {
        this.#settleVideoDecode(entry, staleResult ?? this.#failedVideoFrameResult());
      }
      return;
    }

    const staleResult = this.#staleVideoFrameResultIfRequestIsNotCurrent(options);
    if (staleResult != undefined) {
      closeDecodeResultFrame(result);
      for (const entry of entries) {
        this.#settleVideoDecode(entry, staleResult);
      }
      return;
    }

    if (result.type !== "TargetFrame" && result.type !== "IntermediateFrame") {
      for (const entry of entries) {
        this.#settleVideoDecode(
          entry,
          result.type === "Timeout"
            ? this.#timeoutVideoFrameResult()
            : result.type === "FrameOutOfOrder"
              ? this.#frameOutOfOrderVideoFrameResult()
              : this.#failedVideoFrameResult(),
        );
      }
      if (result.type === "Timeout" && options.retainLateTarget === true) {
        void this.#awaitTargetVideoFrame(decoder, requestId, entries[entries.length - 1]!, {
          isVideoFrameRequestCurrent: options.isVideoFrameRequestCurrent,
          onLateTargetFrameSettled: options.onLateTargetFrameSettled,
          targetFrameTimeoutMs: options.targetFrameTimeoutMs,
          anyFrameTimeoutMs: options.anyFrameTimeoutMs,
        });
      }
      return;
    }

    const targetEntry = entries[entries.length - 1]!;
    const resultEntry =
      (result.batchIndex != undefined ? entries[result.batchIndex] : undefined) ??
      entries.find(
        (entry) =>
          toNanoSec(entry.frame.timestamp) === result.originalTimestamp &&
          entry.receiveTime === result.receiveTime,
      );
    const cachedDecodedFrame = this.#compressedVideoFrameEventForDecodedFrame(result);
    const decodedFrame = resultEntry?.messageEvent ?? cachedDecodedFrame;

    for (const entry of entries) {
      if (entry === targetEntry) {
        continue;
      }
      this.#settleVideoDecode(entry, this.#failedVideoFrameResult());
    }
    this.#settleVideoDecode(targetEntry, {
      image: result.frame,
      ok: true,
      decodedFrame,
    });
    if (result.type === "IntermediateFrame" && options.retainLateTarget === true) {
      void this.#awaitTargetVideoFrame(decoder, requestId, targetEntry, {
        isVideoFrameRequestCurrent: options.isVideoFrameRequestCurrent,
        onLateTargetFrameSettled: options.onLateTargetFrameSettled,
        targetFrameTimeoutMs: options.targetFrameTimeoutMs,
        anyFrameTimeoutMs: options.anyFrameTimeoutMs,
      });
    }
  }

  async #awaitTargetVideoFrame(
    decoder: WorkerImageDecoder,
    requestId: number,
    targetEntry: PendingVideoDecode,
    options: Pick<
      SetCompressedVideoFramesOptions,
      | "isVideoFrameRequestCurrent"
      | "onLateTargetFrameSettled"
      | "targetFrameTimeoutMs"
      | "anyFrameTimeoutMs"
    > = {},
  ): Promise<void> {
    this.#lateTargetRequestId = requestId;
    let result: Awaited<ReturnType<WorkerImageDecoder["awaitTargetFrame"]>>;
    try {
      result = await decoder.awaitTargetFrame({
        requestId,
        timeoutMs:
          options.anyFrameTimeoutMs ??
          options.targetFrameTimeoutMs ??
          DEFAULT_VIDEO_ANY_FRAME_TIMEOUT_MS,
      });
    } catch {
      options.onLateTargetFrameSettled?.({ ok: false, reason: "failed" });
      return;
    }
    if (result.type !== "TargetFrame") {
      options.onLateTargetFrameSettled?.({ ok: false, reason: "failed" });
      return;
    }
    if (
      this.isDisposed() ||
      this.#lateTargetRequestId !== requestId ||
      requestId !== this.#videoDecodeRequestId ||
      targetEntry.seq !== this.#receivedImageSequenceNumber
    ) {
      result.frame.close();
      options.onLateTargetFrameSettled?.({ ok: false, reason: "stale" });
      return;
    }

    const staleResult = this.#staleVideoFrameResultIfRequestIsNotCurrent(options);
    if (staleResult != undefined) {
      result.frame.close();
      options.onLateTargetFrameSettled?.(imageSetResult(staleResult));
      return;
    }

    const cachedDecodedFrame = this.#compressedVideoFrameEventForDecodedFrame(result);
    const decodedFrame = targetEntry.messageEvent ?? cachedDecodedFrame;

    this.#handleDecodedImage(
      targetEntry.seq,
      { image: result.frame, ok: true, decodedFrame },
      () => {
        if (decodedFrame != undefined) {
          targetEntry.updateImageState?.(decodedFrame);
        }
        targetEntry.onDecoded?.();
      },
      (displayResult) => options.onLateTargetFrameSettled?.(displayResult),
      () =>
        this.#lateTargetRequestId === requestId && options.isVideoFrameRequestCurrent?.() !== false,
      undefined,
      decodedFrame != undefined
        ? () => targetEntry.canDisplayFrame?.(decodedFrame) !== false
        : undefined,
    );
  }

  public cancelLateTargetFrame(): void {
    const requestId = this.#lateTargetRequestId;
    this.#lateTargetRequestId = undefined;
    if (requestId != undefined) {
      void this.decoder?.cancelTargetFrame(requestId).catch((error: unknown) => {
        log.error(error);
      });
    }
  }

  #settleVideoDecode(entry: PendingVideoDecode, result: DecodedImageResult): void {
    if (entry.settled) {
      if (result.image != undefined) {
        this.#closeDecodedImageIfUnused(result.image);
      }
      return;
    }
    entry.settled = true;
    entry.resolve(result);
  }

  #cancelPendingVideoDecodes(result?: DecodedImageResult): void {
    const batch = this.#activeVideoDecodeBatch;
    this.#activeVideoDecodeBatch = undefined;
    const cancellationResult = result ?? this.#failedVideoFrameResult();
    for (const entry of batch ?? []) {
      this.#settleVideoDecode(entry, cancellationResult);
    }
  }

  #failedVideoFrameResult(): DecodedImageResult {
    return {
      ok: false,
      reason: "failed",
    };
  }

  #timeoutVideoFrameResult(): DecodedImageResult {
    return {
      ok: false,
      reason: "timeout",
    };
  }

  #frameOutOfOrderVideoFrameResult(): DecodedImageResult {
    return {
      ok: false,
      reason: "frame-out-of-order",
    };
  }

  #staleVideoFrameResult(): DecodedImageResult {
    return {
      ok: false,
      reason: "stale",
    };
  }

  #staleVideoFrameResultIfRequestIsNotCurrent(
    options: Pick<SetCompressedVideoFramesOptions, "isVideoFrameRequestCurrent">,
  ): DecodedImageResult | undefined {
    return options.isVideoFrameRequestCurrent != undefined &&
      !this.#videoFrameRequestIsCurrent(options)
      ? this.#staleVideoFrameResult()
      : undefined;
  }

  #videoFrameRequestIsCurrent(
    options: Pick<SetCompressedVideoFramesOptions, "isVideoFrameRequestCurrent">,
  ): boolean {
    return options.isVideoFrameRequestCurrent?.() ?? true;
  }

  public update(): void {
    if (this.#isUpdating) {
      return;
    }
    this.#isUpdating = true;

    if (this.#textureNeedsUpdate && this.#decodedImage) {
      this.#updateTexture();
      this.#textureNeedsUpdate = false;
    }

    if (this.userData.image) {
      this.updateHeaderInfo();
    }

    if (this.#geometryNeedsUpdate && this.userData.cameraModel) {
      this.#rebuildGeometry();
      this.#geometryNeedsUpdate = false;
    }

    if (this.#materialNeedsUpdate) {
      this.#updateMaterial();
      this.#materialNeedsUpdate = false;
    }

    if (
      this.#meshNeedsUpdate &&
      this.userData.texture &&
      this.userData.geometry &&
      this.userData.material
    ) {
      this.#updateMesh();
      this.#meshNeedsUpdate = false;
    }
    this.#isUpdating = false;
  }

  #rebuildGeometry() {
    assert(this.userData.cameraModel, "Camera model must be set before geometry can be updated");
    // Dispose of the current geometry if the settings have changed
    this.userData.geometry?.dispose();
    this.userData.geometry = undefined;
    const geometry = createGeometry(this.userData.cameraModel, this.userData.settings);
    this.userData.geometry = geometry;
    this.#meshNeedsUpdate = true;
  }

  #updateTexture(): void {
    assert(
      this.#decodedImage,
      "Decoded image must be set before texture can be updated or created",
    );
    const decodedImage = this.#decodedImage;
    // Create or update the texture
    if (isVideoFrame(decodedImage)) {
      const texture = this.userData.texture;
      if (
        texture == undefined ||
        !(texture.image instanceof VideoFrame) ||
        !videoFrameDimensionsEqual(decodedImage, texture.image)
      ) {
        closeDecodedImageResource(texture?.image);
        texture?.dispose();
        this.userData.texture = createVideoFrameTexture(decodedImage);
      } else {
        if (texture.image === decodedImage) {
          return;
        }
        texture.image.close();
        texture.image = decodedImage;
        texture.needsUpdate = true;
      }
    } else if (decodedImage instanceof ImageBitmap) {
      const canvasTexture = this.userData.texture;
      if (
        canvasTexture == undefined ||
        // instanceof check allows us to switch from a raw image (DataTexture) to a compressed image (CanvasTexture)
        !(canvasTexture instanceof THREE.CanvasTexture) ||
        !bitmapDimensionsEqual(decodedImage, canvasTexture.image as ImageBitmap | undefined)
      ) {
        closeDecodedImageResource(canvasTexture?.image);
        canvasTexture?.dispose();
        this.userData.texture = createCanvasTexture(decodedImage);
      } else {
        if (canvasTexture.image === decodedImage) {
          return;
        }
        closeDecodedImageResource(canvasTexture.image);
        canvasTexture.image = decodedImage;
        canvasTexture.needsUpdate = true;
      }
    } else {
      let dataTexture = this.userData.texture;
      if (
        dataTexture == undefined ||
        // instanceof check allows us to switch from a compressed image (CanvasTexture) to a raw image (DataTexture)
        !(dataTexture instanceof THREE.DataTexture) ||
        dataTexture.image.width !== decodedImage.width ||
        dataTexture.image.height !== decodedImage.height
      ) {
        closeDecodedImageResource(dataTexture?.image);
        dataTexture?.dispose();
        dataTexture = createDataTexture(decodedImage);
        this.userData.texture = dataTexture;
      } else {
        dataTexture.image = decodedImage;
        dataTexture.needsUpdate = true;
      }
    }
    this.#materialNeedsUpdate = true;
  }

  #updateMaterial(): void {
    if (!this.userData.material) {
      this.#initMaterial();
      this.#meshNeedsUpdate = true;
    }
    const material = this.userData.material!;

    const texture = this.userData.texture;
    if (texture) {
      material.uniforms.map = { value: texture };
    }

    tempColor = stringToRgba(tempColor, this.userData.settings.color);
    const transparent = tempColor.a < 1;
    const color = new THREE.Color(tempColor.r, tempColor.g, tempColor.b);
    const { brightness, contrast } = this.userData.settings;
    material.uniforms.color = { value: color };
    material.uniforms.brightness = { value: clampBrightness(brightness) };
    material.uniforms.contrast = { value: clampContrast(contrast) };
    material.uniforms.opacity = { value: tempColor.a };
    material.opacity = tempColor.a;
    material.transparent = transparent;
    material.depthWrite = !transparent;

    if (this.#renderBehindScene) {
      material.depthWrite = false;
      material.depthTest = false;
    } else {
      material.depthTest = true;
    }

    material.needsUpdate = true;
  }

  #initMaterial(): void {
    stringToRgba(tempColor, this.userData.settings.color);
    const transparent = tempColor.a < 1;
    const color = new THREE.Color(tempColor.r, tempColor.g, tempColor.b);
    const { brightness, contrast } = this.userData.settings;
    const uniforms = {
      map: { value: this.userData.texture },
      color: { value: color },
      opacity: { value: tempColor.a },
      brightness: { value: clampBrightness(brightness) },
      contrast: { value: clampContrast(contrast) },
    };
    this.userData.material = new THREE.ShaderMaterial({
      name: `${this.userData.topic}:Material`,
      uniforms,
      side: THREE.DoubleSide,
      opacity: tempColor.a,
      transparent,
      depthWrite: !transparent,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  #updateMesh(): void {
    assert(this.userData.geometry, "Geometry must be set before mesh can be updated or created");
    assert(this.userData.material, "Material must be set before mesh can be updated or created");
    if (!this.userData.mesh) {
      this.userData.mesh = new THREE.Mesh(this.userData.geometry, this.userData.material);
      this.add(this.userData.mesh);
    } else {
      this.userData.mesh.geometry = this.userData.geometry;
      this.userData.mesh.material = this.userData.material;
    }

    if (!this.#renderBehindScene) {
      this.userData.mesh.renderOrder = 0;
      return;
    }

    this.userData.mesh.renderOrder = -1 * Number.MAX_SAFE_INTEGER;
  }

  protected addError(key: string, message: string): void {
    if (this.isDisposed()) {
      return;
    }
    // must account for if the renderable is part of `ImageMode` or `Images` scene extension
    this.renderer.settings.errors.add(IMAGE_TOPIC_PATH, key, message);
    this.renderer.settings.errors.addToTopic(this.userData.topic, key, message);
  }

  protected removeError(key: string): void {
    this.renderer.settings.errors.remove(IMAGE_TOPIC_PATH, key);
    this.renderer.settings.errors.removeFromTopic(this.userData.topic, key);
  }
}

let tempColor = { r: 0, g: 0, b: 0, a: 0 };

function createCanvasTexture(bitmap: ImageBitmap): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(
    bitmap,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.LinearFilter,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.generateMipmaps = false;
  // Color space needs to be set to LinearSRGBColorSpace for correct color rendering on custom Shader
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  return texture;
}

function createVideoFrameTexture(frame: VideoFrame): THREE.Texture {
  const texture = new THREE.Texture(
    frame,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.LinearFilter,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.generateMipmaps = false;
  // Color space needs to be set to LinearSRGBColorSpace for correct color rendering on custom Shader
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  // VideoFrame needs explicit Y flip to match ImageBitmap orientation
  texture.flipY = false;
  texture.repeat.set(1, -1);
  texture.offset.set(0, 1);
  texture.needsUpdate = true;
  return texture;
}

function createDataTexture(imageData: ImageData): THREE.DataTexture {
  const dataTexture = new THREE.DataTexture(
    imageData.data,
    imageData.width,
    imageData.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.LinearFilter,
    1,
    // Color space needs to be set to LinearSRGBColorSpace for correct color rendering on custom Shader
    THREE.LinearSRGBColorSpace,
  );
  dataTexture.needsUpdate = true; // ensure initial image data is displayed
  return dataTexture;
}

function createGeometry(
  cameraModel: PinholeCameraModel,
  settings: ImageRenderableSettings,
): THREE.PlaneGeometry {
  const WIDTH_SEGMENTS = 100;
  const HEIGHT_SEGMENTS = 100;

  const width = cameraModel.width;
  const height = cameraModel.height;
  const geometry = new THREE.PlaneGeometry(1, 1, WIDTH_SEGMENTS, HEIGHT_SEGMENTS);

  const gridX1 = WIDTH_SEGMENTS + 1;
  const gridY1 = HEIGHT_SEGMENTS + 1;
  const size = gridX1 * gridY1;

  const segmentWidth = width / WIDTH_SEGMENTS;
  const segmentHeight = height / HEIGHT_SEGMENTS;

  // Use a slight offset to avoid z-fighting with the CameraInfo wireframe
  const EPS = 1e-3;

  // Rebuild the position buffer for the plane by iterating through the grid and
  // projecting each pixel space x/y coordinate into a 3D ray and casting out by
  // the user-configured distance setting. UV coordinates are rebuilt so the
  // image is not vertically flipped
  const pixel = { x: 0, y: 0 };
  const p = { x: 0, y: 0, z: 0 };
  const vertices = new Float32Array(size * 3);
  const uvs = new Float32Array(size * 2);
  for (let iy = 0; iy < gridY1; iy++) {
    for (let ix = 0; ix < gridX1; ix++) {
      const vOffset = (iy * gridX1 + ix) * 3;
      const uvOffset = (iy * gridX1 + ix) * 2;

      pixel.x = ix * segmentWidth;
      pixel.y = iy * segmentHeight;
      projectPixel(p, pixel, cameraModel, settings);

      vertices[vOffset + 0] = p.x;
      vertices[vOffset + 1] = p.y;
      vertices[vOffset + 2] = p.z - EPS;

      uvs[uvOffset + 0] = ix / WIDTH_SEGMENTS;
      uvs[uvOffset + 1] = iy / HEIGHT_SEGMENTS;
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.attributes.position!.needsUpdate = true;
  geometry.attributes.uv!.needsUpdate = true;

  return geometry;
}

const bitmapDimensionsEqual = (a?: ImageBitmap, b?: ImageBitmap) =>
  a?.width === b?.width && a?.height === b?.height;

const videoFrameDimensionsEqual = (a?: VideoFrame, b?: VideoFrame) =>
  a?.displayWidth === b?.displayWidth && a?.displayHeight === b?.displayHeight;

const isVideoFrame = (
  value: ImageBitmap | ImageData | VideoFrame | undefined,
): value is VideoFrame => typeof VideoFrame !== "undefined" && value instanceof VideoFrame;

function closeDecodedImageResource(resource: unknown): void {
  if (resource == undefined) {
    return;
  }
  if (typeof VideoFrame !== "undefined" && resource instanceof VideoFrame) {
    resource.close();
    return;
  }
  if (typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap) {
    resource.close();
  }
}

function closeDecodeResultFrame(result: DecodeVideoFramesResult): void {
  if (result.type === "TargetFrame" || result.type === "IntermediateFrame") {
    result.frame.close();
  }
}

function imageSetResult(result: DecodedImageResult): ImageSetImageResult {
  if (result.ok) {
    const okResult: Extract<ImageSetImageResult, { ok: true }> = { ok: true };
    if (result.decodedFrame != undefined) {
      okResult.decodedFrame = result.decodedFrame;
    }
    return okResult;
  }
  if (result.reason === "stale") {
    const staleResult: Extract<ImageSetImageResult, { ok: false; reason: "stale" }> = {
      ok: false,
      reason: "stale",
    };
    if (result.decodedFrame != undefined) {
      staleResult.decodedFrame = result.decodedFrame;
    }
    return staleResult;
  }
  const failedResult: Extract<
    ImageSetImageResult,
    { ok: false; reason: "failed" | "timeout" | "frame-out-of-order" }
  > = {
    ok: false,
    reason: result.reason,
  };
  if (result.decodedFrame != undefined) {
    failedResult.decodedFrame = result.decodedFrame;
  }
  return failedResult;
}
