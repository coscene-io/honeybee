/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook } from "@testing-library/react";

import {
  createGrowthBookClient,
  GrowthBookProvider,
  initializeGrowthBookClient,
  readGrowthBookRuntimeConfig,
  useFeatureIsOnWithConfig,
  useFeatureValueWithConfig,
} from "./GrowthBookProvider";
import type { GrowthBookRuntimeConfig } from "./GrowthBookProvider";

const mockLogWarn = jest.fn();
const originalGrowthBookEnv = {
  GROWTHBOOK_API_HOST: process.env.GROWTHBOOK_API_HOST,
  GROWTHBOOK_CLIENT_KEY: process.env.GROWTHBOOK_CLIENT_KEY,
  GROWTHBOOK_ENABLED: process.env.GROWTHBOOK_ENABLED,
};

jest.mock("@foxglove/log", () => ({
  __esModule: true,
  default: { getLogger: () => ({ warn: (...args: unknown[]) => mockLogWarn(...args) }) },
}));

function makeConfig(overrides: Partial<GrowthBookRuntimeConfig> = {}): GrowthBookRuntimeConfig {
  return {
    apiHost: "https://growthbook.example.com",
    clientKey: "client-key",
    enabled: true,
    fallbackValues: { example_boolean: true, example_value: "local" },
    ...overrides,
  };
}

describe("GrowthBookProvider", () => {
  afterEach(() => {
    window.cosConfig = undefined;
    for (const [key, value] of Object.entries(originalGrowthBookEnv)) {
      if (value == undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("reads and trims the runtime cos-config values", () => {
    window.cosConfig = {
      FEATURE_FLAG_GROWTHBOOK: { example_boolean: true },
      GROWTHBOOK_API_HOST: " https://runtime.example.com/ ",
      GROWTHBOOK_CLIENT_KEY: " client-key ",
      GROWTHBOOK_ENABLED: true,
    } as NonNullable<Window["cosConfig"]>;

    expect(readGrowthBookRuntimeConfig()).toEqual({
      apiHost: "https://runtime.example.com/",
      clientKey: "client-key",
      enabled: true,
      fallbackValues: { example_boolean: true },
    });
  });

  it("does not use build-time environment variables when runtime config is absent", () => {
    process.env.GROWTHBOOK_API_HOST = "https://build-time.example.com";
    process.env.GROWTHBOOK_CLIENT_KEY = "build-time-key";
    process.env.GROWTHBOOK_ENABLED = "true";

    expect(readGrowthBookRuntimeConfig()).toEqual({
      apiHost: "",
      clientKey: "",
      enabled: false,
      fallbackValues: {},
    });
  });

  it.each([
    ["disabled", { enabled: false }],
    ["missing client key", { clientKey: "" }],
    ["invalid API host", { apiHost: "not-a-url" }],
  ])("does not initialize the remote client when %s", async (_name, overrides) => {
    const config = makeConfig(overrides);
    const client = createGrowthBookClient(config);
    const init = jest.spyOn(client, "init");

    await expect(initializeGrowthBookClient(client, config)).resolves.toBeUndefined();

    expect(init).not.toHaveBeenCalled();
    expect(client.getFeatureValue("example_boolean", false)).toBe(true);
  });

  it("initializes the runtime host with streaming enabled", async () => {
    const config = makeConfig({ apiHost: "https://runtime.example.com" });
    const client = createGrowthBookClient(config);
    const init = jest.spyOn(client, "init").mockResolvedValue({ source: "network", success: true });

    await initializeGrowthBookClient(client, config);

    expect(client.getApiHosts()).toMatchObject({
      apiHost: "https://runtime.example.com",
      streamingHost: "https://runtime.example.com",
    });
    expect(init).toHaveBeenCalledWith({ streaming: true });
  });

  it("keeps local fallbacks when remote initialization fails", async () => {
    const config = makeConfig();
    const client = createGrowthBookClient(config);
    const error = new Error("GrowthBook unavailable");
    jest.spyOn(client, "init").mockResolvedValue({ error, source: "error", success: false });

    await expect(initializeGrowthBookClient(client, config)).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      "Failed to initialize GrowthBook; using local feature flag fallbacks",
      error,
    );
    expect(client.getFeatureValue("example_boolean", false)).toBe(true);
  });

  it("exposes reusable boolean and value hooks backed by local config", () => {
    window.cosConfig = {
      FEATURE_FLAG_GROWTHBOOK: { example_boolean: true, example_value: "local" },
      GROWTHBOOK_API_HOST: "https://runtime.example.com",
      GROWTHBOOK_CLIENT_KEY: "",
      GROWTHBOOK_ENABLED: true,
    } as NonNullable<Window["cosConfig"]>;

    const { result } = renderHook(
      () => ({
        boolean: useFeatureIsOnWithConfig("example_boolean"),
        missing: useFeatureIsOnWithConfig("missing_boolean"),
        value: useFeatureValueWithConfig("example_value", "default"),
      }),
      { wrapper: GrowthBookProvider },
    );

    expect(result.current).toEqual({ boolean: true, missing: false, value: "local" });
  });
});
