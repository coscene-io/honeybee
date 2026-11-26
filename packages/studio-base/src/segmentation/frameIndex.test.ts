// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { frameAt, polygonsOnFrame, topicFrameIndex, videoFrameAt } from "./frameIndex";
import { frameInstanceKey } from "./service";
import type { FrameInstance, SegmentationDocument, SegmentationFrame } from "./types";

const START_NS = 1_700_000_000_000_000_000n;
const CAMERAS = ["front", "rear", "left", "right", "top"];
const INSTANCES = ["a", "b", "c"];

/** Five 30 fps cameras with `seconds` of registered frames, every instance on every frame. */
function recording(seconds: number) {
  const frames: SegmentationFrame[] = [];
  const annotations: Record<string, FrameInstance> = {};
  for (const camera of CAMERAS) {
    for (let index = 0; index < seconds * 30; index++) {
      const logTimeNs = (START_NS + BigInt(index) * 33_333_333n).toString();
      const id = `${camera}:${logTimeNs}`;
      frames.push({
        id,
        videoId: camera,
        index,
        timestampSec: index / 30,
        logTimeNs,
        imageUrl: "",
      });
      for (const instanceId of INSTANCES) {
        annotations[frameInstanceKey(id, instanceId)] = {
          frameId: id,
          instanceId,
          kind: "polygons",
          polygons: [
            {
              id: `${id}-${instanceId}`,
              points: [
                { x: 0.1, y: 0.1 },
                { x: 0.2, y: 0.1 },
                { x: 0.2, y: 0.2 },
              ],
            },
          ],
        };
      }
    }
  }
  const document: Pick<SegmentationDocument, "frames" | "videos" | "instances" | "annotations"> = {
    videos: CAMERAS.map((camera) => ({
      id: camera,
      recordId: "record",
      name: camera,
      topic: `/${camera}`,
      durationSec: seconds,
      fps: 30,
      sizeBytes: 0,
      mediaUrl: "",
    })),
    frames,
    instances: INSTANCES.map((id) => ({ id, classId: "class", name: id })),
    annotations,
  };
  return document;
}

/**
 * Counts reads of frame rows and of observations. The work of showing one frame on each camera
 * must not depend on how many frames were registered or loaded before it.
 */
function readsToShowLastFrames(seconds: number) {
  const plain = recording(seconds);
  let reads = 0;
  const frames = new Proxy(plain.frames, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        reads++;
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  const annotations = new Proxy(plain.annotations, {
    get(target, key, receiver) {
      reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
    ownKeys(target) {
      reads += Object.keys(target).length;
      return Reflect.ownKeys(target);
    },
  });
  const document = { ...plain, frames, annotations };
  // The index is built when the tables change, not per refresh.
  topicFrameIndex(document);
  reads = 0;
  const last = (seconds * 30 - 1) * 33_333_333;
  let polygons = 0;
  for (const camera of CAMERAS) {
    // What the polygon preview looks up: its video and the exact displayed log time.
    const frame = videoFrameAt(document, camera, (START_NS + BigInt(last)).toString());
    expect(frame?.videoId).toBe(camera);
    polygons += polygonsOnFrame(document, frame!.id).length;
  }
  expect(polygons).toBe(CAMERAS.length * INSTANCES.length);
  return reads;
}

describe("frameIndex", () => {
  it("finds the displayed frame with the same work after 10 seconds or 10 minutes", () => {
    const short = readsToShowLastFrames(10);
    const long = readsToShowLastFrames(600);
    expect(long).toBe(short);
    // No row of the frames table, and one observation per instance, per camera.
    expect(short).toBe(CAMERAS.length * INSTANCES.length);
  });

  it("keeps the index until the tables grow, then sees the new frames", () => {
    const document = recording(1);
    const index = topicFrameIndex(document);
    expect(topicFrameIndex(document)).toBe(index);
    const logTimeNs = (START_NS + 30n * 33_333_333n).toString();
    document.frames.push({
      id: `front:${logTimeNs}`,
      videoId: "front",
      index: 30,
      timestampSec: 1,
      logTimeNs,
      imageUrl: "",
    });
    expect(topicFrameIndex(document)).not.toBe(index);
    expect(frameAt(document, "/front", logTimeNs)?.id).toBe(`front:${logTimeNs}`);
    expect(frameAt(document, "/front", "1")).toBeUndefined();
  });

  it("tells apart media files of one record that share a camera topic", () => {
    const document = recording(1);
    const logTimeNs = START_NS.toString();
    document.videos.push({ ...document.videos[0]!, id: "front-second-file" });
    document.frames.push({
      id: `front-second-file:${logTimeNs}`,
      videoId: "front-second-file",
      index: 0,
      timestampSec: 0,
      logTimeNs,
      imageUrl: "",
    });
    expect(videoFrameAt(document, "front", logTimeNs)?.id).toBe(`front:${logTimeNs}`);
    expect(videoFrameAt(document, "front-second-file", logTimeNs)?.id).toBe(
      `front-second-file:${logTimeNs}`,
    );
    expect(videoFrameAt(document, "missing", logTimeNs)).toBeUndefined();
  });
});
