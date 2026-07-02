// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";
import type { ShareManifest } from "@foxglove/studio-base/util/shareManifest";

import CoSceneShareManifestDataSourceFactory from "./CoSceneShareManifestDataSourceFactory";

jest.mock("@foxglove/studio-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerSerializedIterableSource: jest.fn().mockImplementation((options: unknown) => ({
    options,
  })),
}));

const mockIterablePlayer = IterablePlayer as unknown as jest.Mock;
const mockWorkerSerializedIterableSource = WorkerSerializedIterableSource as unknown as jest.Mock;

function encodeBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

describe("CoSceneShareManifestDataSourceFactory", () => {
  const manifest: ShareManifest = {
    version: 1,
    expireTime: "2026-06-30T10:00:00Z",
    links: {
      mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap?sig=playback",
      layout: "https://mock-storage.example.com/shares/layout.json?sig=layout",
    },
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-06-25T00:00:00Z") });
    mockIterablePlayer.mockClear();
    mockWorkerSerializedIterableSource.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("is a hidden authless connection source", () => {
    const factory = new CoSceneShareManifestDataSourceFactory();

    expect(factory.id).toBe(SHARE_MANIFEST_DATA_SOURCE_ID);
    expect(factory.type).toBe("connection");
    expect(factory.hidden).toBe(true);
    expect((factory as { needLogin?: unknown }).needLogin).toBeUndefined();
  });

  it("uses the manifest mini_mcap URL as the remote MCAP source", () => {
    const encodedManifest = encodeBase64Url(manifest);
    const factory = new CoSceneShareManifestDataSourceFactory();

    factory.initialize({
      metricsCollector: undefined as never,
      params: { manifest: encodedManifest },
    });

    expect(mockWorkerSerializedIterableSource).toHaveBeenCalledTimes(1);
    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: { url: manifest.links.mini_mcap },
    });
    expect(mockIterablePlayer).toHaveBeenCalledTimes(1);
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      sourceId: SHARE_MANIFEST_DATA_SOURCE_ID,
      urlParams: { manifest: encodedManifest },
      name: "Shared MCAP",
      enablePlaybackSpillCache: true,
      playbackSpillCacheSourceKey: JSON.stringify({
        sourceId: SHARE_MANIFEST_DATA_SOURCE_ID,
        url: manifest.links.mini_mcap,
      }),
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).not.toMatchObject({
      urlParams: { shardMode: "manifest" },
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).not.toMatchObject({
      urlParams: { manifestUrl: expect.any(String) },
    });
  });

  it("uses direct manifestUrl params as a shard manifest source", () => {
    const manifestUrl = "https://mock-storage.example.com/public/shards/manifest.json";
    const layoutUrl = "https://mock-storage.example.com/public/layouts/share.json";
    const factory = new CoSceneShareManifestDataSourceFactory();

    factory.initialize({
      metricsCollector: undefined as never,
      params: {
        manifestUrl,
        layoutUrl,
        profile: "720p",
      },
    });

    expect(mockWorkerSerializedIterableSource).toHaveBeenCalledTimes(1);
    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: { params: { url: manifestUrl, profile: "720p" } },
    });
    expect(mockIterablePlayer).toHaveBeenCalledTimes(1);
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      sourceId: SHARE_MANIFEST_DATA_SOURCE_ID,
      urlParams: {
        shardMode: "manifest",
        manifestUrl,
        layoutUrl,
        profile: "720p",
      },
      name: "Shared shard manifest (720p)",
      enablePlaybackSpillCache: true,
      playbackSpillCacheSourceKey: JSON.stringify({
        params: { profile: "720p", url: manifestUrl },
        sourceId: SHARE_MANIFEST_DATA_SOURCE_ID,
      }),
    });
  });

  it("ignores raw profile params for direct shard manifest sources", () => {
    const manifestUrl = "https://mock-storage.example.com/public/shards/manifest.json";
    const factory = new CoSceneShareManifestDataSourceFactory();

    factory.initialize({
      metricsCollector: undefined as never,
      params: {
        manifestUrl,
        profile: "raw",
      },
    });

    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: { params: { url: manifestUrl } },
    });
    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).not.toMatchObject({
      initArgs: { params: { profile: "raw" } },
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      urlParams: {
        shardMode: "manifest",
        manifestUrl,
      },
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).not.toMatchObject({
      urlParams: { profile: "raw" },
    });
  });

  it("rejects expired manifests before constructing a player", () => {
    const encodedManifest = encodeBase64Url({
      ...manifest,
      expireTime: "2026-06-20T10:00:00Z",
    });
    const factory = new CoSceneShareManifestDataSourceFactory();

    expect(() =>
      factory.initialize({
        metricsCollector: undefined as never,
        params: { manifest: encodedManifest },
      }),
    ).toThrow("Share manifest has expired");
    expect(mockWorkerSerializedIterableSource).not.toHaveBeenCalled();
    expect(mockIterablePlayer).not.toHaveBeenCalled();
  });
});
