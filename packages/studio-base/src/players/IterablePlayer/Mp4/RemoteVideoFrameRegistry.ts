// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import type { MessageDefinition } from "@foxglove/message-definition";
import { Time } from "@foxglove/rostime";

export const REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME = "coscene.RemoteVideoFrameReference";
export const REMOTE_VIDEO_FRAME_REFERENCE_DATATYPES = new Set([
  REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME,
]);
export const REMOTE_VIDEO_FRAME_REFERENCE_DATATYPE = {
  name: REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME,
  definitions: [
    { name: "timestamp", type: "time" },
    { name: "duration", type: "duration" },
    { name: "frame_id", type: "string" },
    { name: "provider_id", type: "string" },
    { name: "rotation", type: "float64" },
  ],
} satisfies MessageDefinition;

/** A serializable timeline marker. The decoded frame stays outside player message caches. */
export type RemoteVideoFrameReference = {
  timestamp: Time;
  duration: Time;
  frame_id: string;
  provider_id: string;
  rotation: number;
};

export interface RemoteVideoFrameProvider {
  getFrame(timestamp: Time, consumerId: string): Promise<VideoFrame>;
}

const providers = new Map<string, RemoteVideoFrameProvider>();

export function registerRemoteVideoFrameProvider(
  id: string,
  provider: RemoteVideoFrameProvider,
): () => void {
  if (providers.has(id)) {
    throw new Error(`A remote video frame provider is already registered for ${id}`);
  }
  providers.set(id, provider);
  return () => {
    if (providers.get(id) === provider) {
      providers.delete(id);
    }
  };
}

export async function getRemoteVideoFrame(
  reference: RemoteVideoFrameReference,
  consumerId: string,
): Promise<VideoFrame> {
  const provider = providers.get(reference.provider_id);
  if (!provider) {
    throw new Error("The remote MP4 decoder is no longer available");
  }
  return await provider.getFrame(reference.timestamp, consumerId);
}

export function isRemoteVideoFrameReference(value: unknown): value is RemoteVideoFrameReference {
  return (
    typeof value === "object" &&
    value != undefined &&
    "provider_id" in value &&
    typeof value.provider_id === "string"
  );
}
