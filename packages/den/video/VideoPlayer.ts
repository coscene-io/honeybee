// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Mutex } from "async-mutex";
import EventEmitter from "eventemitter3";

import Logger from "@foxglove/log";

// foxglove-depcheck-used: @types/dom-webcodecs

export type VideoPlayerEventTypes = {
  frame: (frame: VideoFrame) => void;
  debug: (message: string) => void;
  warn: (message: string) => void;
  error: (error: Error) => void;
};

const log = Logger.getLogger(__filename);

/**
 * A wrapper around the WebCodecs VideoDecoder API that uses an async queue model
 * for high-performance decoding. Frames are submitted to the decoder without waiting
 * for each frame to complete, and decoded frames are buffered for retrieval.
 *
 * This design is optimized for high-speed playback scenarios where blocking on each
 * frame decode would cause performance issues and visual artifacts.
 */
export class VideoPlayer extends EventEmitter<VideoPlayerEventTypes> {
  readonly #decoderInit: VideoDecoderInit;
  #decoder: VideoDecoder;
  #decoderConfig: VideoDecoderConfig | undefined;
  readonly #mutex = new Mutex();
  #codedSize: { width: number; height: number } | undefined;

  /** Buffer of decoded frames, newest frames are pushed to the end */
  #frameBuffer: VideoFrame[] = [];

  /** Whether we have received a keyframe and can start decoding */
  #foundKeyFrame = false;

  // Stores the last decoded frame as an ImageBitmap, should be set after decode()
  public lastImageBitmap: ImageBitmap | undefined;

  /** Reports whether video decoding is supported in this browser session */
  public static IsSupported(): boolean {
    return self.isSecureContext && "VideoDecoder" in globalThis;
  }

  public constructor() {
    super();
    this.#decoderInit = {
      output: (videoFrame: VideoFrame) => {
        // Push new frame to buffer
        this.#frameBuffer.push(videoFrame);

        // Update coded size from the frame
        if (!this.#codedSize) {
          this.#codedSize = { width: 0, height: 0 };
        }
        this.#codedSize.width = videoFrame.codedWidth;
        this.#codedSize.height = videoFrame.codedHeight;

        this.emit("frame", videoFrame);
      },
      error: (error) => this.emit("error", error),
    };
    this.#decoder = new VideoDecoder(this.#decoderInit);
  }

  /**
   * Configures the VideoDecoder with the given VideoDecoderConfig. This must
   * be called before decode() will accept frames.
   */
  public async init(decoderConfig: VideoDecoderConfig): Promise<void> {
    await this.#mutex.runExclusive(async () => {
      // Optimize for latency means we do not have to call flush() in every decode() call
      // See <https://github.com/w3c/webcodecs/issues/206>
      decoderConfig.optimizeForLatency = true;

      // Try with 'prefer-hardware' first
      let modifiedConfig = { ...decoderConfig };
      modifiedConfig.hardwareAcceleration = "prefer-hardware";

      let support = await VideoDecoder.isConfigSupported(modifiedConfig);
      if (support.supported !== true) {
        log.warn(
          `VideoDecoder does not support configuration ${JSON.stringify(
            modifiedConfig,
          )}. Trying without 'prefer-hardware'`,
        );
        // If 'prefer-hardware' is not supported, try without it
        modifiedConfig = { ...decoderConfig };
        support = await VideoDecoder.isConfigSupported(modifiedConfig);
      }

      if (support.supported !== true) {
        const err = new Error(
          `VideoDecoder does not support configuration ${JSON.stringify(decoderConfig)}`,
        );
        this.emit("error", err);
        return;
      }

      if (this.#decoder.state === "closed") {
        this.emit("debug", "VideoDecoder is closed, creating a new one");
        this.#decoder = new VideoDecoder(this.#decoderInit);
      }

      this.emit("debug", `Configuring VideoDecoder with ${JSON.stringify(decoderConfig)}`);
      this.#decoder.configure(decoderConfig);
      this.#decoderConfig = decoderConfig;
      this.#codedSize = undefined;
      if (decoderConfig.codedWidth != undefined && decoderConfig.codedHeight != undefined) {
        this.#codedSize = { width: decoderConfig.codedWidth, height: decoderConfig.codedHeight };
      }
    });
  }

  /** Returns true if the VideoDecoder is open and configured, ready for decoding. */
  public isInitialized(): boolean {
    return this.#decoder.state === "configured";
  }

  /** Returns the VideoDecoderConfig given to init(), or undefined if init() has not been called. */
  public decoderConfig(): VideoDecoderConfig | undefined {
    return this.#decoderConfig;
  }

  /** Returns the dimensions of the coded video frames, if known. */
  public codedSize(): { width: number; height: number } | undefined {
    return this.#codedSize;
  }

  /**
   * Submits a chunk of encoded video bitstream to the decoder for async decoding.
   * This method returns immediately without waiting for the decode to complete.
   * Use getLatestFrame() to retrieve decoded frames.
   *
   * @param data A chunk of encoded video bitstream
   * @param timestampMicros The timestamp of the chunk in microseconds
   * @param type "key" if this chunk contains a keyframe, "delta" otherwise
   */
  public decodeAsync(data: Uint8Array, timestampMicros: number, type: "key" | "delta"): void {
    if (this.#decoder.state === "closed") {
      this.emit("warn", "VideoDecoder is closed, creating a new one");
      this.#decoder = new VideoDecoder(this.#decoderInit);
    }

    if (this.#decoder.state === "unconfigured") {
      this.emit("debug", "Waiting for initialization...");
      return;
    }

    // Track keyframe state - we need a keyframe before we can decode delta frames
    if (type === "key") {
      this.#foundKeyFrame = true;
    }

    if (!this.#foundKeyFrame) {
      return;
    }

    try {
      this.#decoder.decode(new EncodedVideoChunk({ type, data, timestamp: timestampMicros }));
    } catch (unk) {
      const error = new Error(
        `Failed to decode ${data.byteLength} byte chunk at time ${timestampMicros}: ${
          (unk as Error).message
        }`,
      );
      this.emit("error", error);
    }
  }

  /**
   * Takes a chunk of encoded video bitstream, sends it to the VideoDecoder,
   * and returns a Promise that resolves to the decoded VideoFrame. If the
   * VideoDecoder is not yet configured, we are waiting on a keyframe, or we
   * time out waiting for the decoder to return a frame, this will return
   * undefined.
   *
   * @param data A chunk of encoded video bitstream
   * @param timestampMicros The timestamp of the chunk of encoded video
   *   bitstream in microseconds relative to the start of the stream
   * @param type "key" if this chunk contains a keyframe, "delta" otherwise
   * @returns A VideoFrame or undefined if no frame was decoded
   */
  public async decode(
    data: Uint8Array,
    timestampMicros: number,
    type: "key" | "delta",
  ): Promise<VideoFrame | undefined> {
    // Submit frame for async decoding
    this.decodeAsync(data, timestampMicros, type);

    // Return the latest available frame (if any)
    return this.getLatestFrame();
  }

  /**
   * Returns the latest decoded frame from the buffer, closing all older frames.
   * Returns undefined if no frames are available.
   */
  public getLatestFrame(): VideoFrame | undefined {
    if (this.#frameBuffer.length === 0) {
      return undefined;
    }

    // Get the latest frame (last in buffer)
    const latestFrame = this.#frameBuffer.pop();

    // Close all older frames to free resources
    for (const oldFrame of this.#frameBuffer) {
      oldFrame.close();
    }
    this.#frameBuffer = [];

    return latestFrame;
  }

  /**
   * Returns the number of frames currently buffered.
   */
  public bufferedFrameCount(): number {
    return this.#frameBuffer.length;
  }

  /**
   * Reset the VideoDecoder and clear any pending frames, but do not clear any
   * cached stream information or decoder configuration. This should be called
   * when seeking to a new position in the stream.
   *
   * Note: After reset(), the decoder goes to "unconfigured" state, so we
   * reconfigure it with the saved config.
   */
  public resetForSeek(): void {
    if (this.#decoder.state === "configured") {
      this.#decoder.reset();
      // After reset(), decoder is in "unconfigured" state, need to reconfigure
      if (this.#decoderConfig) {
        this.#decoder.configure(this.#decoderConfig);
      }
    }

    // Clear the frame buffer
    for (const frame of this.#frameBuffer) {
      frame.close();
    }
    this.#frameBuffer = [];

    // Reset keyframe tracking - need a new keyframe after seek
    this.#foundKeyFrame = false;
  }

  /**
   * Close the VideoDecoder and clear any pending frames. Also clear any cached
   * stream information or decoder configuration.
   */
  public close(): void {
    if (this.#decoder.state !== "closed") {
      this.#decoder.close();
    }

    // Clear the frame buffer
    for (const frame of this.#frameBuffer) {
      frame.close();
    }
    this.#frameBuffer = [];

    this.#foundKeyFrame = false;
  }
}
