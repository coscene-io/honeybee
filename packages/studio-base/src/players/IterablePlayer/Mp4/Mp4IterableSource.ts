// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import {
  GetBackfillMessagesArgs,
  IDeserializedIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";

import type { Mp4FrameIndexEntry, Mp4MediabunnyInfo } from "./Mp4MediabunnyController";
import {
  REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME,
  RemoteVideoFrameProvider,
  RemoteVideoFrameReference,
  registerRemoteVideoFrameProvider,
} from "./RemoteVideoFrameRegistry";
import { WorkerMp4MediabunnyController } from "./WorkerMp4MediabunnyController";

export const DEFAULT_MP4_VIDEO_TOPIC = "/camera/h264";

/** Use the requested topic, or the source default when it is missing/empty. */
export function resolveRemoteMp4Topic(topic: string | undefined): string {
  return topic == undefined || topic.length === 0 ? DEFAULT_MP4_VIDEO_TOPIC : topic;
}

type Mp4Controller = RemoteVideoFrameProvider & {
  initialize(): Promise<Mp4MediabunnyInfo>;
  dispose(): Promise<void>;
};

function lowerBound(frames: readonly Mp4FrameIndexEntry[], timestampNs: bigint): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (frames[middle]!.timestampNs < timestampNs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export class Mp4IterableSource implements IDeserializedIterableSource {
  readonly #controller: Mp4Controller;
  readonly #providerId: string;
  readonly #topic: string;
  #info?: Mp4MediabunnyInfo;
  #unregisterProvider?: () => void;

  public readonly sourceType = "deserialized";

  public constructor({
    url,
    topic = DEFAULT_MP4_VIDEO_TOPIC,
    controller,
    providerId = globalThis.crypto.randomUUID(),
  }: {
    url: string;
    topic?: string;
    controller?: Mp4Controller;
    providerId?: string;
  }) {
    this.#controller = controller ?? new WorkerMp4MediabunnyController(url);
    this.#providerId = providerId;
    this.#topic = topic;
  }

  public async initialize(): Promise<Initalization> {
    const info = await this.#controller.initialize();
    this.#info = info;
    this.#unregisterProvider?.();
    this.#unregisterProvider = registerRemoteVideoFrameProvider(this.#providerId, this.#controller);

    return {
      start: fromNanoSec(0n),
      end: fromNanoSec(info.endTimeNs),
      topics: [{ name: this.#topic, schemaName: REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME }],
      topicStats: new Map([[this.#topic, { numMessages: info.frames.length }]]),
      datatypes: new Map(),
      profile: "mp4",
      publishersByTopic: new Map(),
      problems: [],
      metadata: [
        {
          name: "MP4 video",
          metadata: {
            codec: info.codec,
            resolution: `${info.width}x${info.height}`,
            timing: "Mediabunny presentation order (B-frame and VFR aware)",
            transport: "HTTP Range (200 MiB bounded cache)",
          },
        },
      ],
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    if (!args.topics.has(this.#topic)) {
      return;
    }
    const info = this.#requireInfo();
    const startTimeNs = args.start ? toNanoSec(args.start) : 0n;
    const endTimeNs = args.end ? toNanoSec(args.end) : info.endTimeNs;

    for (let index = lowerBound(info.frames, startTimeNs); index < info.frames.length; index++) {
      if (args.abortSignal?.aborted === true) {
        return;
      }
      const frame = info.frames[index]!;
      if (frame.timestampNs > endTimeNs) {
        return;
      }
      yield { type: "message-event", msgEvent: this.#messageEvent(frame) };
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
  }: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    if (!topics.has(this.#topic) || abortSignal?.aborted === true) {
      return [];
    }
    const frames = this.#requireInfo().frames;
    const index = lowerBound(frames, toNanoSec(time) + 1n) - 1;
    if (index < 0) {
      return [];
    }
    return [this.#messageEvent(frames[index]!)];
  }

  public async terminate(): Promise<void> {
    this.#unregisterProvider?.();
    this.#unregisterProvider = undefined;
    await this.#controller.dispose();
  }

  #messageEvent(frame: Mp4FrameIndexEntry): MessageEvent<RemoteVideoFrameReference> {
    const timestamp = fromNanoSec(frame.timestampNs);
    return {
      topic: this.#topic,
      receiveTime: timestamp,
      publishTime: timestamp,
      schemaName: REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME,
      sizeInBytes: 64,
      message: {
        timestamp,
        duration: fromNanoSec(frame.durationNs),
        frame_id: "",
        provider_id: this.#providerId,
        rotation: this.#requireInfo().rotation,
      },
    };
  }

  #requireInfo(): Mp4MediabunnyInfo {
    if (!this.#info) {
      throw new Error("MP4 source is not initialized");
    }
    return this.#info;
  }
}
