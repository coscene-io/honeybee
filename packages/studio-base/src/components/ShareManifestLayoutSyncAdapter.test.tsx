/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";

import { ShareManifestLayoutSyncAdapter } from "@foxglove/studio-base/components/ShareManifestLayoutSyncAdapter";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const mockSetCurrentLayout = jest.fn();
const mockEnqueueSnackbar = jest.fn();

jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: unknown) => unknown) =>
    selector({ dataSource: { id: "coscene-share-manifest", type: "connection" } }),
}));

jest.mock("@foxglove/studio-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: () => ({ setCurrentLayout: mockSetCurrentLayout }),
}));

jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}));

function encodeBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

describe("<ShareManifestLayoutSyncAdapter />", () => {
  const layoutUrl = "https://mock-storage.example.com/shares/layout.json?sig=layout";
  const manifestUrl = "https://mock-storage.example.com/public/shards/manifest.json";
  const directLayoutUrl = "https://mock-storage.example.com/public/layouts/share.json";
  const originalFetch = global.fetch;
  const expectedBlankLayout = {
    id: "share-manifest-layout",
    name: "Shared layout",
    transient: true,
    data: {
      configById: {},
      globalVariables: {},
      userNodes: {},
    },
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-06-25T00:00:00Z") });
    mockSetCurrentLayout.mockClear();
    mockEnqueueSnackbar.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        layout: "RawMessages!1",
        savedProps: { "RawMessages!1": { diffEnabled: true } },
        globalVariables: {},
        userNodes: {},
      }),
    });
    const manifest = encodeBase64Url({
      version: 1,
      expireTime: "2026-06-30T10:00:00Z",
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap?sig=playback",
        layout: layoutUrl,
      },
    });
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz#manifest=${manifest}`,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("loads the manifest layout as a transient in-memory layout", async () => {
    render(<ShareManifestLayoutSyncAdapter />);

    await waitFor(() => {
      expect(mockSetCurrentLayout).toHaveBeenCalledWith({
        id: "share-manifest-layout",
        name: "Shared layout",
        transient: true,
        data: {
          layout: "RawMessages!1",
          configById: { "RawMessages!1": { diffEnabled: true } },
          globalVariables: {},
          userNodes: {},
        },
      });
    });
    expect(global.fetch).toHaveBeenCalledWith(layoutUrl, { signal: expect.any(AbortSignal) });
    expect(SHARE_MANIFEST_DATA_SOURCE_ID).toBe("coscene-share-manifest");
  });

  it("loads direct layoutUrl as the highest priority transient layout", async () => {
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz?ds=coscene-share-manifest#manifestUrl=${encodeURIComponent(
        manifestUrl,
      )}&layoutUrl=${encodeURIComponent(directLayoutUrl)}`,
    );

    render(<ShareManifestLayoutSyncAdapter />);

    await waitFor(() => {
      expect(mockSetCurrentLayout).toHaveBeenCalledWith({
        id: "share-manifest-layout",
        name: "Shared layout",
        transient: true,
        data: {
          layout: "RawMessages!1",
          configById: { "RawMessages!1": { diffEnabled: true } },
          globalVariables: {},
          userNodes: {},
        },
      });
    });
    expect(global.fetch).toHaveBeenCalledWith(directLayoutUrl, {
      signal: expect.any(AbortSignal),
    });
    expect(global.fetch).not.toHaveBeenCalledWith(manifestUrl, {
      signal: expect.any(AbortSignal),
    });
  });

  it("loads direct shard manifest links.layout when layoutUrl is missing", async () => {
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz?ds=coscene-share-manifest#manifestUrl=${encodeURIComponent(
        manifestUrl,
      )}`,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          links: { layout: directLayoutUrl },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          layout: "RawMessages!1",
          savedProps: { "RawMessages!1": { diffEnabled: true } },
          globalVariables: {},
          userNodes: {},
        }),
      });

    render(<ShareManifestLayoutSyncAdapter />);

    await waitFor(() => {
      expect(mockSetCurrentLayout).toHaveBeenCalledWith({
        id: "share-manifest-layout",
        name: "Shared layout",
        transient: true,
        data: {
          layout: "RawMessages!1",
          configById: { "RawMessages!1": { diffEnabled: true } },
          globalVariables: {},
          userNodes: {},
        },
      });
    });
    expect(global.fetch).toHaveBeenNthCalledWith(1, manifestUrl, {
      signal: expect.any(AbortSignal),
    });
    expect(global.fetch).toHaveBeenNthCalledWith(2, directLayoutUrl, {
      signal: expect.any(AbortSignal),
    });
  });

  it("falls back to a blank transient layout when no layout URL is available", async () => {
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz?ds=coscene-share-manifest#manifestUrl=${encodeURIComponent(
        manifestUrl,
      )}`,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ links: {} }),
    });

    render(<ShareManifestLayoutSyncAdapter />);

    await waitFor(() => {
      expect(mockSetCurrentLayout).toHaveBeenCalledWith(expectedBlankLayout);
    });
  });

  it("reports layout fetch failures and falls back to a blank transient layout", async () => {
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz?ds=coscene-share-manifest#manifestUrl=${encodeURIComponent(
        manifestUrl,
      )}&layoutUrl=${encodeURIComponent(directLayoutUrl)}`,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    render(<ShareManifestLayoutSyncAdapter />);

    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        "Shared layout could not be loaded. HTTP 403",
        { variant: "error" },
      );
      expect(mockSetCurrentLayout).toHaveBeenCalledWith(expectedBlankLayout);
    });
  });
});
