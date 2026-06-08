// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef, useState } from "react";

import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { CompressedVideo } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/ImageTypes";
import { WorkerImageDecoder } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { normalizeCompressedVideo } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";
import { VideoGopCache } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/videoGopCache";

/** A single decoded thumbnail anchored to a fraction [0,1] across the recording. */
export type TimelineThumbnail = {
  fraction: number;
  bitmap: ImageBitmap;
};

export type TimelineThumbnailStatus = "idle" | "loading" | "ready" | "unavailable";

export type UseTimelineThumbnailsResult = {
  thumbnails: TimelineThumbnail[];
  status: TimelineThumbnailStatus;
};

/** Decoded thumbnail width in pixels. Kept small to bound memory/decode cost. */
const THUMB_DECODE_WIDTH = 160;
/** Hard cap on the number of thumbnails decoded for a single recording. */
const MAX_THUMBNAIL_COUNT = 60;

const selectSubscribeMessageRange = (ctx: MessagePipelineContext) => ctx.subscribeMessageRange;

function timeKey(time: Time | undefined): string | undefined {
  return time ? `${time.sec}.${time.nsec}` : undefined;
}

/**
 * Headlessly decodes a strip of video thumbnails for the timeline by reusing the same
 * machinery as the 3D/Image panel: `subscribeMessageRange` to fetch encoded frames over the
 * full recording, `VideoGopCache` to resolve the GOP for each sample time, and
 * `WorkerImageDecoder` (WebCodecs in a worker) to decode them.
 *
 * Phase 2: decodes a fixed set of `count` samples across the whole recording once (the timeline
 * viewport is currently the full range — zoom is disabled). Viewport-aware regeneration, an LRU
 * cache, and the "decode each GOP once" optimization are future work.
 */
export function useTimelineThumbnails(params: {
  enabled: boolean;
  topic: undefined | string;
  startTime: Time | undefined;
  endTime: Time | undefined;
  count: number;
}): UseTimelineThumbnailsResult {
  const { enabled, topic, startTime, endTime, count } = params;
  const subscribeMessageRange = useMessagePipeline(selectSubscribeMessageRange);

  const [thumbnails, setThumbnails] = useState<TimelineThumbnail[]>([]);
  const [status, setStatus] = useState<TimelineThumbnailStatus>("idle");

  // Keep the latest Time objects in refs so the effect can depend on stable string keys (avoiding
  // churn from new Time object identities) without tripping exhaustive-deps.
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  startTimeRef.current = startTime;
  endTimeRef.current = endTime;

  const startKey = timeKey(startTime);
  const endKey = timeKey(endTime);
  const clampedCount = Math.min(MAX_THUMBNAIL_COUNT, Math.max(0, Math.floor(count)));

  useEffect(() => {
    const start = startTimeRef.current;
    const end = endTimeRef.current;
    if (
      !enabled ||
      topic == undefined ||
      start == undefined ||
      end == undefined ||
      clampedCount < 1 ||
      subscribeMessageRange == undefined
    ) {
      setThumbnails([]);
      setStatus(subscribeMessageRange == undefined && enabled ? "unavailable" : "idle");
      return;
    }

    const abortController = new AbortController();
    const isAborted = () => abortController.signal.aborted;
    const produced: ImageBitmap[] = [];

    setThumbnails([]);
    setStatus("loading");

    const run = async () => {
      // 1. Pull every encoded frame in the recording into a GOP cache.
      const cache = new VideoGopCache();
      // Held on an object so the mutation inside the async iterator closure is visible to the
      // later check (a plain `let` would be narrowed to its initial `false`).
      const collected = { hasVideo: false };
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribeMessageRange({
          topic,
          timeRange: { start, end },
          onNewRangeIterator: async (iterator) => {
            try {
              for await (const batch of iterator) {
                if (isAborted()) {
                  return;
                }
                for (const msg of batch) {
                  if (cache.addFrame(msg)) {
                    collected.hasVideo = true;
                  }
                }
              }
            } finally {
              resolve();
            }
          },
        });
        if (unsubscribe == undefined) {
          resolve();
          return;
        }
        abortController.signal.addEventListener(
          "abort",
          () => {
            unsubscribe();
            resolve();
          },
          { once: true },
        );
      });

      if (isAborted()) {
        return;
      }
      if (!collected.hasVideo) {
        setStatus("unavailable");
        return;
      }

      // 2. Decode one frame per sample slot, in time order.
      const decoder = new WorkerImageDecoder();
      const startNs = toNanoSec(start);
      const endNs = toNanoSec(end);
      const spanNs = Number(endNs - startNs);
      let requestId = 0;

      try {
        for (let i = 0; i < clampedCount; i++) {
          if (isAborted()) {
            return;
          }
          // Sample the center of each evenly-sized cell so tiles tile edge-to-edge.
          const fraction = (i + 0.5) / clampedCount;
          const slotNs = startNs + BigInt(Math.round(spanNs * fraction));
          const slotTime = fromNanoSec(slotNs);

          const gop = cache.framesForReceiveTime(topic, slotTime);
          if (gop == undefined || gop.length === 0) {
            continue;
          }

          // Each GOP starts at a keyframe; reset so the decoder doesn't see a backwards jump.
          await decoder.resetVideoDecoder();
          const result = await decoder.decodeVideoFrames({
            requestId: ++requestId,
            frames: gop.map((msg) => ({
              frame: normalizeCompressedVideo(msg.message as CompressedVideo),
              receiveTime: toNanoSec(msg.receiveTime),
            })),
          });
          if (isAborted()) {
            return;
          }
          if (result.type !== "TargetFrame" && result.type !== "IntermediateFrame") {
            continue;
          }

          const frame = result.frame;
          try {
            const resizeWidth = THUMB_DECODE_WIDTH;
            const resizeHeight = Math.max(
              1,
              Math.round((resizeWidth * frame.displayHeight) / frame.displayWidth),
            );
            const bitmap = await createImageBitmap(frame, {
              resizeWidth,
              resizeHeight,
              resizeQuality: "low",
            });
            if (isAborted()) {
              bitmap.close();
              return;
            }
            produced.push(bitmap);
            setThumbnails((prev) => [...prev, { fraction, bitmap }]);
          } finally {
            frame.close();
          }
        }
        if (!isAborted()) {
          setStatus("ready");
        }
      } finally {
        decoder.terminate();
      }
    };

    run().catch(() => {
      if (!isAborted()) {
        setStatus("unavailable");
      }
    });

    return () => {
      abortController.abort();
      for (const bitmap of produced) {
        bitmap.close();
      }
    };
  }, [enabled, topic, startKey, endKey, clampedCount, subscribeMessageRange]);

  return { thumbnails, status };
}
