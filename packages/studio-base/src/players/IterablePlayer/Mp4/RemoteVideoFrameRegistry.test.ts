// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { fromNanoSec } from "@foxglove/rostime";

import {
  RemoteVideoFrameReference,
  getRemoteVideoFrame,
  getRemoteVideoSourceMetadata,
  registerRemoteVideoFrameProvider,
} from "./RemoteVideoFrameRegistry";

const REFERENCE: RemoteVideoFrameReference = {
  timestamp: fromNanoSec(1_000_000_000n),
  duration: fromNanoSec(100_000_000n),
  frame_id: "",
  provider_id: "test-provider",
  rotation: 0,
};

describe("RemoteVideoFrameRegistry", () => {
  it("resolves frames until the provider is unregistered", async () => {
    const frame = { close: jest.fn() } as unknown as VideoFrame;
    const provider = { getFrame: jest.fn(async () => frame) };
    const unregister = registerRemoteVideoFrameProvider(REFERENCE.provider_id, provider);

    await expect(getRemoteVideoFrame(REFERENCE)).resolves.toBe(frame);
    expect(provider.getFrame).toHaveBeenCalledWith(REFERENCE.timestamp);

    unregister();
    await expect(getRemoteVideoFrame(REFERENCE)).rejects.toThrow(
      "The remote MP4 decoder is no longer available",
    );
  });

  it("rejects duplicate provider IDs", () => {
    const provider = { getFrame: jest.fn() };
    const unregister = registerRemoteVideoFrameProvider(REFERENCE.provider_id, provider);

    try {
      expect(() => {
        registerRemoteVideoFrameProvider(REFERENCE.provider_id, provider);
      }).toThrow(
        `A remote video frame provider is already registered for ${REFERENCE.provider_id}`,
      );
    } finally {
      unregister();
    }
  });

  it("exposes immutable real presentation metadata only for the provider lifetime", () => {
    const frames = [
      { timestampNs: 0n, durationNs: 300n },
      { timestampNs: 300n, durationNs: 600n },
    ];
    const unregister = registerRemoteVideoFrameProvider(
      "metadata-provider",
      { getFrame: jest.fn() },
      { sourceId: "fixture.mp4", topic: "/camera", frames },
    );
    const metadata = getRemoteVideoSourceMetadata("metadata-provider");
    expect(metadata?.frames).toEqual(frames);
    frames.push({ timestampNs: 900n, durationNs: 100n });
    expect(metadata?.frames).toHaveLength(2);
    expect(Object.isFrozen(metadata?.frames)).toBe(true);
    unregister();
    expect(getRemoteVideoSourceMetadata("metadata-provider")).toBeUndefined();
  });
});
