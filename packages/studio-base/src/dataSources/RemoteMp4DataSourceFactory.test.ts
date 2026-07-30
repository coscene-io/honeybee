// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";
import { DEFAULT_MP4_VIDEO_TOPIC } from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4IterableSource";

import RemoteMp4DataSourceFactory from "./RemoteMp4DataSourceFactory";

jest.mock("@foxglove/studio-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerIterableSource: jest.fn().mockImplementation((options: unknown) => ({ options })),
}));

const mockIterablePlayer = IterablePlayer as unknown as jest.Mock;
const mockWorkerIterableSource = WorkerIterableSource as unknown as jest.Mock;

describe("RemoteMp4DataSourceFactory", () => {
  beforeEach(() => {
    mockIterablePlayer.mockClear();
    mockWorkerIterableSource.mockClear();
  });

  it("creates a worker player with deep-link URL and default topic", () => {
    const factory = new RemoteMp4DataSourceFactory();
    factory.initialize({
      metricsCollector: undefined as never,
      params: { url: "https://storage.example.com/recording.mp4" },
      enablePlaybackSpillCache: true,
    });

    expect(mockWorkerIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: {
        url: "https://storage.example.com/recording.mp4",
        params: { topic: DEFAULT_MP4_VIDEO_TOPIC },
      },
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      sourceId: "remote-mp4",
      urlParams: {
        url: "https://storage.example.com/recording.mp4",
        topic: DEFAULT_MP4_VIDEO_TOPIC,
      },
      enablePlaybackSpillCache: true,
    });
  });

  it("rejects non-MP4 URLs", () => {
    const factory = new RemoteMp4DataSourceFactory();
    expect(() =>
      factory.initialize({
        metricsCollector: undefined as never,
        params: { url: "https://storage.example.com/recording.mcap" },
      }),
    ).toThrow("URL must end with .mp4");
  });
});
