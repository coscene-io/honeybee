// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec, type Time } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";
import type { RemoteVideoSourceMetadata } from "@foxglove/studio-base/players/IterablePlayer/Mp4/RemoteVideoFrameRegistry";
import type { PlayerURLState } from "@foxglove/studio-base/players/types";

export type SegmentationImage = Readonly<{
  imageUrl: string;
  topic: string;
  /** Both stamps belong to the message whose pixels have actually been displayed. */
  timestamp: Time;
  receiveTime: Time;
  decodedIdentity: object;
  providerId?: string;
  source?: RemoteVideoSourceMetadata;
}>;

export type SegmentationImageSource = () => SegmentationImage | undefined;

/** Bridges the Image renderer's separate React root to its enclosing coStudio panel. */
export const segmentationImageSources = new WeakMap<HTMLCanvasElement, SegmentationImageSource>();

/** Frames the panel's decoder cache still holds, keyed by the same canvas as the capture. */
export const segmentationCachedFrames = new WeakMap<HTMLCanvasElement, () => MessageEvent[]>();

export function imageFrameIdentity(
  image: Pick<SegmentationImage, "timestamp" | "receiveTime">,
): string {
  return `${toNanoSec(image.timestamp)}:${toNanoSec(image.receiveTime)}`;
}

/** Backfill selects the last actual presentation at or before the player clock, including VFR gaps. */
export function presentationFrameAt(
  frames: readonly { timestampNs: bigint }[],
  time: bigint,
): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (frames[mid]!.timestampNs <= time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

/** Player IDs fence live bindings, while persisted annotations use reproducible source identity. */
export function segmentationSourceKey({
  dataAssetName,
  filename,
  sizeBytes,
  urlState,
  sourceUrl,
  playerId,
}: {
  dataAssetName?: string;
  filename?: string;
  sizeBytes?: string;
  urlState?: PlayerURLState;
  sourceUrl?: string;
  playerId: string;
}): string {
  if (dataAssetName) {
    return dataAssetName;
  }
  if (sourceUrl) {
    return JSON.stringify(["video-url", sourceUrl])!;
  }
  const parameters = Object.entries(urlState?.parameters ?? {})
    .filter(([key]) => key !== "topic")
    .sort(([a], [b]) => a.localeCompare(b));
  if (urlState && parameters.length > 0) {
    return JSON.stringify([urlState.sourceId, parameters])!;
  }
  if (filename) {
    return JSON.stringify(["file", urlState?.sourceId, filename, sizeBytes])!;
  }
  if (urlState) {
    return JSON.stringify([urlState.sourceId, parameters])!;
  }
  return `transient:${playerId}`;
}
