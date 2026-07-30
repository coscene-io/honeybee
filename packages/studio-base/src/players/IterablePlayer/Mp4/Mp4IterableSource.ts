// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import {
  GetBackfillMessagesArgs,
  IDeserializedIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";

import { Mp4Demuxer, Mp4VideoFrame } from "./Mp4Demuxer";

export const DEFAULT_MP4_VIDEO_TOPIC = "/camera/h264";
export const COMPRESSED_VIDEO_SCHEMA_NAME = "foxglove.CompressedVideo";

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

type CompressedVideo = {
  timestamp: ReturnType<typeof fromNanoSec>;
  frame_id: string;
  data: Uint8Array;
  format: string;
};

export class Mp4IterableSource implements IDeserializedIterableSource {
  readonly #demuxer: Mp4Demuxer;
  readonly #topic: string;
  #startTimeNs?: bigint;
  #endTimeNs?: bigint;

  public readonly sourceType = "deserialized";

  public constructor({ url, topic = DEFAULT_MP4_VIDEO_TOPIC }: { url: string; topic?: string }) {
    this.#demuxer = new Mp4Demuxer(url);
    this.#topic = topic;
  }

  public async initialize(): Promise<Initalization> {
    const info = await this.#demuxer.initialize();
    this.#startTimeNs = info.startTimeNs;
    this.#endTimeNs = info.endTimeNs;

    return {
      start: fromNanoSec(info.startTimeNs),
      end: fromNanoSec(info.endTimeNs),
      topics: [{ name: this.#topic, schemaName: COMPRESSED_VIDEO_SCHEMA_NAME }],
      topicStats: new Map([[this.#topic, { numMessages: info.samples.length }]]),
      datatypes: new Map(),
      profile: "mp4",
      publishersByTopic: new Map(),
      problems: info.hasBFrames
        ? [
            {
              severity: "warn",
              message:
                "This MP4 contains B-frame reordering, which foxglove.CompressedVideo does not support. Frames are emitted in decode order and playback may be inaccurate.",
              tip: "Use an H.264/H.265 MP4 encoded without B-frames for frame-accurate annotation.",
            },
          ]
        : [],
      metadata: [
        {
          name: "MP4 video",
          metadata: {
            codec: info.format,
            resolution: `${info.width}x${info.height}`,
            transport: "HTTP Range",
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
    const startTimeNs = args.start ? toNanoSec(args.start) : this.#requireStartTimeNs();
    const endTimeNs = args.end ? toNanoSec(args.end) : this.#requireEndTimeNs();

    for await (const frame of this.#demuxer.frames(startTimeNs, endTimeNs, args.abortSignal)) {
      yield { type: "message-event", msgEvent: this.#messageEvent(frame) };
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
  }: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    if (!topics.has(this.#topic) || isAborted(abortSignal)) {
      return [];
    }
    const frame = await this.#demuxer.frameAtOrBefore(toNanoSec(time));
    if (!frame || isAborted(abortSignal)) {
      return [];
    }
    return [this.#messageEvent(frame)];
  }

  #messageEvent(frame: Mp4VideoFrame): MessageEvent<CompressedVideo> {
    const timestamp = fromNanoSec(frame.timestampNs);
    return {
      topic: this.#topic,
      receiveTime: timestamp,
      publishTime: timestamp,
      schemaName: COMPRESSED_VIDEO_SCHEMA_NAME,
      sizeInBytes: frame.data.byteLength,
      message: {
        timestamp,
        frame_id: "",
        data: frame.data,
        format: frame.format,
      },
    };
  }

  #requireStartTimeNs(): bigint {
    if (this.#startTimeNs == undefined) {
      throw new Error("MP4 source is not initialized");
    }
    return this.#startTimeNs;
  }

  #requireEndTimeNs(): bigint {
    if (this.#endTimeNs == undefined) {
      throw new Error("MP4 source is not initialized");
    }
    return this.#endTimeNs;
  }
}
