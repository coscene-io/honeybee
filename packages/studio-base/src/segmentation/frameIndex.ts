// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "./maskGeometry";
import { frameInstanceKey } from "./service";
import type { SegmentationDocument, SegmentationFrame, SegmentationPolygon } from "./types";

/** The frames of one camera topic, in log time order. */
export type TopicFrames = {
  frames: SegmentationFrame[];
  /** BigInt(frames[i].logTimeNs), parsed once per index build, ascending. */
  times: bigint[];
  /** Position in `frames` by exact log time. */
  byLogTime: Map<string, number>;
};

type Indexed = {
  frameCount: number;
  videos: SegmentationDocument["videos"];
  videoCount: number;
  topics: Map<string, TopicFrames>;
};

// Keyed by the frames table. Runtimes grow their tables in place (registerSource splices them),
// so the lengths are part of the key; frames and videos are only ever added, never removed.
const indexes = new WeakMap<readonly SegmentationFrame[], Indexed>();

/**
 * Frames by camera topic and exact log time, shared by everything that shows the displayed frame
 * (the mask layer and the polygon preview). Built once per source table change, so finding the
 * displayed frame does not grow with the number of frames seen. Returns the same map until the
 * tables change.
 */
export function topicFrameIndex(
  doc: Pick<SegmentationDocument, "frames" | "videos">,
): Map<string, TopicFrames> {
  const cached = indexes.get(doc.frames);
  if (
    cached?.frameCount === doc.frames.length &&
    cached.videos === doc.videos &&
    cached.videoCount === doc.videos.length
  ) {
    return cached.topics;
  }
  const byVideo = new Map<string, SegmentationFrame[]>();
  for (const frame of doc.frames) {
    const list = byVideo.get(frame.videoId) ?? [];
    list.push(frame);
    byVideo.set(frame.videoId, list);
  }
  const topics = new Map<string, TopicFrames>();
  for (const video of doc.videos) {
    if (video.topic == undefined) {
      continue;
    }
    const keyed = (byVideo.get(video.id) ?? []).map((frame) => ({
      frame,
      time: BigInt(frame.logTimeNs),
    }));
    keyed.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const frames = keyed.map((item) => item.frame);
    topics.set(video.topic, {
      frames,
      times: keyed.map((item) => item.time),
      byLogTime: new Map(frames.map((frame, position) => [frame.logTimeNs, position])),
    });
  }
  indexes.set(doc.frames, {
    frameCount: doc.frames.length,
    videos: doc.videos,
    videoCount: doc.videos.length,
    topics,
  });
  return topics;
}

/** The frame of `topic` at exactly `logTimeNs`, if registered. */
export function frameAt(
  doc: Pick<SegmentationDocument, "frames" | "videos">,
  topic: string,
  logTimeNs: string,
): SegmentationFrame | undefined {
  const entry = topicFrameIndex(doc).get(topic);
  const position = entry?.byLogTime.get(logTimeNs);
  return position == undefined ? undefined : entry!.frames[position];
}

/**
 * The polygons on one frame, read by observation key per instance: the cost follows the number
 * of instances, not the number of loaded observations.
 */
export function polygonsOnFrame(
  doc: Pick<SegmentationDocument, "instances" | "annotations">,
  frameId: string,
): SegmentationPolygon[] {
  return doc.instances.flatMap((instance) =>
    polygonsOf(doc.annotations[frameInstanceKey(frameId, instance.id)]),
  );
}
