// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import type { Time } from "@foxglove/rostime";

import type { Mp4MediabunnyInfo } from "./Mp4MediabunnyController";
import type { Mp4MediabunnyControllerWorker } from "./Mp4MediabunnyController.worker";
import type { RemoteVideoFrameProvider } from "./RemoteVideoFrameRegistry";

/** Main-thread proxy for the range transport, Mediabunny demuxer, and WebCodecs decoder worker. */
export class WorkerMp4MediabunnyController implements RemoteVideoFrameProvider {
  readonly #initializeWorker: Comlink.Remote<
    (url: string) => Comlink.Remote<Mp4MediabunnyControllerWorker>
  >;
  readonly #disposeWorker: () => void;
  readonly #url: string;
  #remote?: Comlink.Remote<Mp4MediabunnyControllerWorker>;
  #disposed = false;

  public constructor(url: string) {
    this.#url = url;
    const { remote, dispose } = ComlinkWrap<
      (url: string) => Comlink.Remote<Mp4MediabunnyControllerWorker>
    >(new Worker(new URL("./Mp4MediabunnyController.worker", import.meta.url)));
    this.#initializeWorker = remote;
    this.#disposeWorker = dispose;
  }

  public async initialize(): Promise<Mp4MediabunnyInfo> {
    return await (await this.#getRemote()).initialize();
  }

  public async getFrame(timestamp: Time): Promise<VideoFrame> {
    return await (await this.#getRemote()).getFrame(timestamp);
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    try {
      if (this.#remote) {
        await this.#remote.dispose();
        this.#remote[Comlink.releaseProxy]();
      }
    } finally {
      this.#remote = undefined;
      this.#disposeWorker();
    }
  }

  async #getRemote(): Promise<Comlink.Remote<Mp4MediabunnyControllerWorker>> {
    if (this.#disposed) {
      throw new Error("The remote MP4 decoder has been disposed");
    }
    this.#remote ??= await this.#initializeWorker(this.#url);
    return this.#remote;
  }
}
