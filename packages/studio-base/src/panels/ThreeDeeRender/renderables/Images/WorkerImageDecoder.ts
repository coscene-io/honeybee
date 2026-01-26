// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import { RawImage } from "@foxglove/schemas";

import type { CompressedVideo } from "./ImageTypes";
import { decodeRawImage, RawImageOptions } from "./decodeImage";
import { Image as RosImage } from "../../ros";

/**
 * Provides a worker that can process RawImages on a background thread.
 *
 * The input image data must be **copied** to the worker, because image messages may be used
 * concurrently by other panels and features of the app. However, the resulting decoded data is
 * [transferred](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
 * back to the main thread.
 */

type WorkerService = (typeof import("./WorkerImageDecoder.worker"))["service"];
export class WorkerImageDecoder {
  #remote: Comlink.Remote<WorkerService>;
  #dispose: () => void;

  public constructor() {
    const { remote, dispose } = ComlinkWrap<WorkerService>(
      new Worker(
        // foxglove-depcheck-used: babel-plugin-transform-import-meta
        new URL("./WorkerImageDecoder.worker", import.meta.url),
      ),
    );
    this.#remote = remote;
    this.#dispose = dispose;
  }

  /**
   * decode raw image, raw image will be large, the cost of decoding raw image is much less
   * than the cost of worker transmission, so decode raw image directly in the main thread
   */
  public async decode(
    image: RosImage | RawImage,
    options: Partial<RawImageOptions>,
  ): Promise<ImageData> {
    const result = new ImageData(image.width, image.height);
    decodeRawImage(image, options, result.data);
    return result;
  }

  public async decodeVideoFrame(
    frame: CompressedVideo,
    firstMessageTime: bigint,
  ): Promise<VideoFrame | undefined> {
    // Split into two separate Comlink calls to allow WebCodecs output callback to execute.
    // WebCodecs VideoDecoder.decode() is async - the output callback fires after the current
    // JS execution context completes. By making two independent RPC calls, we create an
    // event loop gap between frame submission and retrieval, giving the decoder time to
    // process and output the frame before we try to fetch it.
    await this.#remote.decodeVideoFrame(frame, firstMessageTime);

    return await this.#remote.getLatestVideoFrame();
  }

  public async resetVideoDecoder(): Promise<void> {
    await this.#remote.resetVideoDecoder();
  }

  public terminate(): void {
    this.#dispose();
  }
}
