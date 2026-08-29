// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as Comlink from "@coscene-io/comlink";

import type { Time } from "@foxglove/rostime";

import { Mp4MediabunnyController, type Mp4MediabunnyInfo } from "./Mp4MediabunnyController";

export class Mp4MediabunnyControllerWorker {
  readonly #controller: Mp4MediabunnyController;

  public constructor(url: string) {
    this.#controller = new Mp4MediabunnyController(url);
  }

  public async initialize(): Promise<Mp4MediabunnyInfo> {
    return await this.#controller.initialize();
  }

  public async getFrame(timestamp: Time, consumerId: string): Promise<VideoFrame> {
    const frame = await this.#controller.getFrame(timestamp, consumerId);
    return Comlink.transfer(frame, [frame]);
  }

  public async dispose(): Promise<void> {
    await this.#controller.dispose();
  }
}

export function initialize(url: string): Mp4MediabunnyControllerWorker & Comlink.ProxyMarked {
  return Comlink.proxy(new Mp4MediabunnyControllerWorker(url));
}

Comlink.expose(initialize);
