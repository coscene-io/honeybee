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
  /** The same frames by video id: one topic can carry several media files of a record. */
  byVideo: Map<string, TopicFrames>;
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
  return indexed(doc).topics;
}

function indexed(doc: Pick<SegmentationDocument, "frames" | "videos">): Indexed {
  const cached = indexes.get(doc.frames);
  if (
    cached?.frameCount === doc.frames.length &&
    cached.videos === doc.videos &&
    cached.videoCount === doc.videos.length
  ) {
    return cached;
  }
  const byVideo = new Map<string, SegmentationFrame[]>();
  for (const frame of doc.frames) {
    const list = byVideo.get(frame.videoId) ?? [];
    list.push(frame);
    byVideo.set(frame.videoId, list);
  }
  const topics = new Map<string, TopicFrames>();
  const videos = new Map<string, TopicFrames>();
  for (const video of doc.videos) {
    const keyed = (byVideo.get(video.id) ?? []).map((frame) => ({
      frame,
      time: BigInt(frame.logTimeNs),
    }));
    keyed.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const frames = keyed.map((item) => item.frame);
    const entry = {
      frames,
      times: keyed.map((item) => item.time),
      byLogTime: new Map(frames.map((frame, position) => [frame.logTimeNs, position])),
    };
    videos.set(video.id, entry);
    if (video.topic != undefined) {
      topics.set(video.topic, entry);
    }
  }
  const next = {
    frameCount: doc.frames.length,
    videos: doc.videos,
    videoCount: doc.videos.length,
    topics,
    byVideo: videos,
  };
  indexes.set(doc.frames, next);
  return next;
}

/**
 * The frame of one video (record, media and topic) at exactly `logTimeNs`, if registered. Unlike
 * a topic, a video id tells apart media files of one record that share a camera topic.
 */
export function videoFrameAt(
  doc: Pick<SegmentationDocument, "frames" | "videos">,
  videoId: string,
  logTimeNs: string,
): SegmentationFrame | undefined {
  const entry = indexed(doc).byVideo.get(videoId);
  const position = entry?.byLogTime.get(logTimeNs);
  return position == undefined ? undefined : entry!.frames[position];
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
