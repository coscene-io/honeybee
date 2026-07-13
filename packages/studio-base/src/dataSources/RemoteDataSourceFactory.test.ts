// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";

import RemoteDataSourceFactory from "./RemoteDataSourceFactory";

const mockGetAppConfig = jest.fn();

jest.mock("@foxglove/studio-base/util/appConfig", () => ({
  getAppConfig: () => mockGetAppConfig(),
  getDomainConfig: () => ({ webDomain: "dev.coscene.cn" }),
}));

jest.mock("@foxglove/studio-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerSerializedIterableSource: jest.fn().mockImplementation((options: unknown) => ({
    options,
  })),
}));

const mockIterablePlayer = IterablePlayer as unknown as jest.Mock;
const mockWorkerSerializedIterableSource = WorkerSerializedIterableSource as unknown as jest.Mock;

describe("RemoteDataSourceFactory", () => {
  beforeEach(() => {
    mockGetAppConfig.mockReturnValue({ PLAYBACK_SPILL_CACHE_ENABLED: false });
    mockIterablePlayer.mockClear();
    mockWorkerSerializedIterableSource.mockClear();
  });

  it.each([false, true])(
    "passes playback spill cache configuration %s to the player",
    (enabled) => {
      mockGetAppConfig.mockReturnValue({ PLAYBACK_SPILL_CACHE_ENABLED: enabled });
      const factory = new RemoteDataSourceFactory();

      factory.initialize({
        metricsCollector: undefined as never,
        params: { url: "https://storage.example.com/recording.mcap" },
      });

      expect(mockWorkerSerializedIterableSource).toHaveBeenCalledTimes(1);
      expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
        enablePlaybackSpillCache: enabled,
      });
    },
  );
});
