// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IterablePlayer,
  WorkerIterableSource,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";

import CoSceneDataPlatformDataSourceFactory, {
  buildManifestUrl,
} from "./CoSceneDataPlatformDataSourceFactory";
import {
  COSCENE_VIZ_DATA_BASE_URL,
  ManifestStorageSource,
  getManifestStorageBaseUrl,
} from "./manifestStorage";

const mockGetAppConfig = jest.fn();

jest.mock("@foxglove/studio-base/util/appConfig", () => ({
  getAppConfig: () => mockGetAppConfig(),
  getDomainConfig: () => ({ webDomain: "dev.coscene.cn" }),
}));

jest.mock("@foxglove/studio-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerIterableSource: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerSerializedIterableSource: jest.fn().mockImplementation((options: unknown) => ({
    options,
  })),
}));

const mockIterablePlayer = IterablePlayer as unknown as jest.Mock;
const mockWorkerIterableSource = WorkerIterableSource as unknown as jest.Mock;
const mockWorkerSerializedIterableSource = WorkerSerializedIterableSource as unknown as jest.Mock;

describe("buildManifestUrl", () => {
  beforeEach(() => {
    mockGetAppConfig.mockReturnValue({
      OBJECT_STORAGE_BASE_URL: "mcap.dev.coscene.cn",
    });
    mockIterablePlayer.mockClear();
    mockWorkerIterableSource.mockClear();
    mockWorkerSerializedIterableSource.mockClear();
  });

  it("adds https protocol to object storage base URL without protocol", () => {
    expect(buildManifestUrl("mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("keeps existing protocol on object storage base URL", () => {
    expect(buildManifestUrl("http://mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "http://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
    expect(buildManifestUrl("https://mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("trims trailing slashes before appending manifest path", () => {
    expect(buildManifestUrl("mcap.dev.coscene.cn///", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("builds the fixed coscene viz data manifest URL", () => {
    expect(buildManifestUrl(COSCENE_VIZ_DATA_BASE_URL, "project-id", "record-id")).toBe(
      "https://coscene-viz-data.coscene.io/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("resolves manifest storage selection to the configured base URL", () => {
    expect(getManifestStorageBaseUrl(ManifestStorageSource.Default, "configured.example.com")).toBe(
      "configured.example.com",
    );
    expect(
      getManifestStorageBaseUrl(ManifestStorageSource.CoSceneVizData, "configured.example.com"),
    ).toBe(COSCENE_VIZ_DATA_BASE_URL);
    expect(getManifestStorageBaseUrl(undefined, "configured.example.com")).toBe(
      "configured.example.com",
    );
  });
});

describe("CoSceneDataPlatformDataSourceFactory manifest storage selection", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetAppConfig.mockReturnValue({
      OBJECT_STORAGE_BASE_URL: "default-storage.example.com",
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response);
    mockIterablePlayer.mockClear();
    mockWorkerIterableSource.mockClear();
    mockWorkerSerializedIterableSource.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function initializeFactory(manifestStorageSource?: string) {
    const factory = new CoSceneDataPlatformDataSourceFactory();
    return await factory.initialize({
      metricsCollector: undefined as never,
      consoleApi: {
        getApiBaseInfo: () => ({ projectId: "project-id", recordId: "record-id" }),
        getAuthHeader: () => "Bearer token",
        getBaseUrl: () => "https://api.example.com",
        getBffUrl: () => "https://bff.example.com",
      } as never,
      manifestStorageSource,
    });
  }

  it("uses OBJECT_STORAGE_BASE_URL by default when checking for a manifest", async () => {
    await initializeFactory();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://default-storage.example.com/projects/project-id/records/record-id/manifest.json",
      { method: "HEAD" },
    );
    expect(mockWorkerSerializedIterableSource).toHaveBeenCalledTimes(1);
  });

  it("uses the fixed coscene viz data URL when selected", async () => {
    await initializeFactory(ManifestStorageSource.CoSceneVizData);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://coscene-viz-data.coscene.io/projects/project-id/records/record-id/manifest.json",
      { method: "HEAD" },
    );
    expect(mockWorkerSerializedIterableSource).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy data-platform player when the selected fixed manifest is unavailable", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false } as Response);

    await initializeFactory(ManifestStorageSource.CoSceneVizData);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalledWith(
      "https://default-storage.example.com/projects/project-id/records/record-id/manifest.json",
      { method: "HEAD" },
    );
    expect(mockWorkerSerializedIterableSource).not.toHaveBeenCalled();
    expect(mockWorkerIterableSource).toHaveBeenCalledTimes(1);
  });
});
