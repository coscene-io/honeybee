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
import { SHARD_PROFILE_PREFERENCE_STORAGE_KEY } from "../players/IterablePlayer/coScene-shard-manifest/profilePreference";

const mockGetAppConfig = jest.fn();
const mockGetWebBasePathname = jest.fn();

jest.mock("@foxglove/studio-base/util/appConfig", () => ({
  getAppConfig: () => mockGetAppConfig(),
  getDomainConfig: () => ({ webDomain: "dev.coscene.cn" }),
  getWebBasePathname: () => mockGetWebBasePathname(),
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
    mockGetWebBasePathname.mockReturnValue("/viz");
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
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );

  beforeEach(() => {
    mockGetAppConfig.mockReturnValue({
      OBJECT_STORAGE_BASE_URL: "default-storage.example.com",
    });
    mockGetWebBasePathname.mockReturnValue("/viz");
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response);
    mockIterablePlayer.mockClear();
    mockWorkerIterableSource.mockClear();
    mockWorkerSerializedIterableSource.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    } else {
      delete (globalThis as Partial<typeof globalThis>).localStorage;
    }
  });

  async function initializeFactory(
    manifestStorageSource?: string,
    params?: Record<string, string | undefined>,
  ) {
    const factory = new CoSceneDataPlatformDataSourceFactory();
    return await factory.initialize({
      metricsCollector: undefined as never,
      params,
      consoleApi: {
        getApiBaseInfo: () => ({ projectId: "project-id", recordId: "record-id" }),
        getAuthHeader: () => "Bearer token",
        getBaseUrl: () => "https://api.example.com",
        getBffUrl: () => "https://bff.example.com",
      } as never,
      manifestStorageSource,
    });
  }

  it("validates data platform URLs against the configured web base path", () => {
    const field = new CoSceneDataPlatformDataSourceFactory().formConfig.fields[0]!;

    expect(
      field.validate("https://dev.coscene.cn/viz?ds=coscene-data-platform&ds.key=example_key"),
    ).toBeUndefined();
    expect(
      field.validate("https://dev.coscene.cn/?ds=coscene-data-platform&ds.key=example_key")
        ?.message,
    ).toBe("url pathname must be /viz");
  });

  it("supports root data platform URLs when the web base path is root", () => {
    mockGetWebBasePathname.mockReturnValue("/");
    const field = new CoSceneDataPlatformDataSourceFactory().formConfig.fields[0]!;

    expect(
      field.validate("https://dev.coscene.cn/?ds=coscene-data-platform&ds.key=example_key"),
    ).toBeUndefined();
    expect(
      field.validate("https://dev.coscene.cn/viz?ds=coscene-data-platform&ds.key=example_key")
        ?.message,
    ).toBe("url pathname must be /");
  });

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

  it("uses a saved shard profile when the new manifest has a matching profile label", async () => {
    const manifestUrl =
      "https://default-storage.example.com/projects/project-id/records/record-id/manifest.json";
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) =>
          key === SHARD_PROFILE_PREFERENCE_STORAGE_KEY
            ? JSON.stringify({ value: "old-hd", label: "720p @ 15fps" })
            : undefined,
      },
    });
    global.fetch = jest.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return { ok: true } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          profiles: [
            { id: "sd10", modality: "video", label: "480p @ 10fps", params: { h: 480, fps: 10 } },
            { id: "hd15", modality: "video", label: "720p @ 15fps", params: { h: 720, fps: 15 } },
          ],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    await initializeFactory();

    expect(global.fetch).toHaveBeenCalledWith(manifestUrl, { method: "HEAD" });
    expect(global.fetch).toHaveBeenCalledWith(manifestUrl);
    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: { params: { url: manifestUrl, profile: "hd15" } },
    });
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      urlParams: { profile: "hd15" },
    });
  });

  it("remaps a stale requested profile when localStorage has the matching profile label", async () => {
    const manifestUrl =
      "https://default-storage.example.com/projects/project-id/records/record-id/manifest.json";
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) =>
          key === SHARD_PROFILE_PREFERENCE_STORAGE_KEY
            ? JSON.stringify({ value: "old-hd", label: "720p @ 15fps" })
            : undefined,
      },
    });
    global.fetch = jest.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return { ok: true } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          profiles: [
            { id: "sd10", modality: "video", label: "480p @ 10fps", params: { h: 480, fps: 10 } },
            { id: "hd15", modality: "video", label: "720p @ 15fps", params: { h: 720, fps: 15 } },
          ],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    await initializeFactory(undefined, { profile: "old-hd" });

    expect(mockWorkerSerializedIterableSource.mock.calls[0]?.[0]).toMatchObject({
      initArgs: { params: { url: manifestUrl, profile: "hd15" } },
    });
  });
});
