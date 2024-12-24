// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import { RawImage } from "@foxglove/schemas";

import { AnyImage } from "./ImageTypes";
import type { RawImageOptions } from "./decodeImage";
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
const log = Logger.getLogger(__filename);

export class WorkerImageDecoder {
  #remote: Comlink.Remote<WorkerService>;
  #dispose: () => void;

  public constructor() {
    log.debug("Creating WorkerImageDecoder");
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
   * Copies `image` to the worker, and transfers the decoded result back to the main thread.
   */
  public async decode(
    image: RosImage | RawImage,
    options: Partial<RawImageOptions>,
  ): Promise<ImageData> {
    return await this.#remote.decode(image, options);
  }

  public async decodeH264Frame(image: AnyImage, receiveTime: bigint): Promise<VideoFrame | undefined> {
    const data = image.data;

    try {
      void this.#remote.decodeH264Frame(data, Number(receiveTime/1000000n));

      return await this.#remote.getH264Frames();
    } catch (error) {
      throw new Error(`Failed to decode H264 frame: ${error}`);
    }
  }

  public terminate(): void {
    this.#dispose();
  }
}
