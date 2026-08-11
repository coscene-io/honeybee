/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, waitFor } from "@testing-library/react";

import { DeepLinksSyncAdapter } from "@foxglove/studio-base/components/DeepLinksSyncAdapter";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const mockSelectSource = jest.fn();
const mockSelectEvent = jest.fn();
const mockSetIsReadyForSyncLayout = jest.fn();
const mockSetLastExternalInitConfig = jest.fn();
const mockDataSourceClose = jest.fn();
const mockSetExternalInitConfig = jest.fn();
const mockBeginExternalInitConfigUpdate = jest.fn();
const mockGetProject = jest.fn();
let mockCurrentUser: { userId: string } | undefined;
let mockLoginStatus = "notLogin";
let mockLastExternalInitConfig: string | undefined;

jest.mock("@foxglove/studio-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ selectSource: mockSelectSource }),
}));

jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (store: unknown) => unknown) =>
    selector({ user: mockCurrentUser, loginStatus: mockLoginStatus }),
}));

jest.mock("@foxglove/studio-base/context/Workspace/WorkspaceContext", () => ({
  useWorkspaceStore: (selector: (store: unknown) => unknown) =>
    selector({ dialogs: { dataSource: { open: true } } }),
}));

jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: () => ({
    dialogActions: { dataSource: { close: mockDataSourceClose } },
  }),
}));

jest.mock("@foxglove/studio-base/context/EventsContext", () => ({
  useEvents: () => mockSelectEvent,
}));

jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: unknown) => unknown) =>
    selector({
      beginExternalInitConfigUpdate: mockBeginExternalInitConfigUpdate,
      setIsReadyForSyncLayout: mockSetIsReadyForSyncLayout,
    }),
}));

jest.mock("@foxglove/studio-base/hooks", () => ({
  useAppConfigurationValue: () => [mockLastExternalInitConfig, mockSetLastExternalInitConfig],
}));

jest.mock("@foxglove/studio-base/components/CoreDataSyncAdapter", () => ({
  useSetExternalInitConfig: () => mockSetExternalInitConfig,
}));

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({ getProject: mockGetProject }),
}));

jest.mock("@foxglove/studio-base/hooks/useSyncLayoutFromUrl", () => ({
  useSyncLayoutFromUrl: jest.fn(),
}));

jest.mock("@foxglove/studio-base/hooks/useSyncTimeFromUrl", () => ({
  useSyncTimeFromUrl: jest.fn(),
}));

jest.mock("@foxglove/studio-base/util/appConfig", () => ({
  getDomainConfig: () => ({ webDomain: "dev.coscene.cn" }),
}));

jest.mock("@foxglove/studio-base/util/isDesktopApp", () => ({
  __esModule: true,
  default: () => false,
}));

function encodeBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

function shareUrl(expiresAt: string): { url: string; encodedManifest: string } {
  const encodedManifest = encodeBase64Url({
    version: 1,
    expireTime: expiresAt,
    links: {
      mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap?sig=playback",
      layout: "https://mock-storage.example.com/shares/layout.json?sig=layout",
    },
  });
  return {
    url: `${window.location.origin}/viz#manifest=${encodedManifest}`,
    encodedManifest,
  };
}

function directShareUrl(profile?: string): string {
  const search = new URLSearchParams({ ds: SHARE_MANIFEST_DATA_SOURCE_ID });
  if (profile != undefined) {
    search.set("ds.profile", profile);
  }
  const hash = new URLSearchParams({
    manifestUrl: "https://mock-storage.example.com/public/shards/manifest.json",
    layoutUrl: "https://mock-storage.example.com/public/layouts/share.json",
  });
  return `${window.location.origin}/viz?${search.toString()}#${hash.toString()}`;
}

describe("<DeepLinksSyncAdapter /> share manifest handling", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-06-25T00:00:00Z") });
    mockCurrentUser = undefined;
    mockLoginStatus = "notLogin";
    mockLastExternalInitConfig = undefined;
    mockSelectSource.mockClear();
    mockSelectEvent.mockClear();
    mockSetIsReadyForSyncLayout.mockClear();
    mockSetLastExternalInitConfig.mockReset();
    mockDataSourceClose.mockClear();
    mockSetExternalInitConfig.mockReset();
    mockBeginExternalInitConfigUpdate.mockReset();
    mockGetProject.mockReset();

    let updateGeneration = 0;
    mockBeginExternalInitConfigUpdate.mockImplementation(() => {
      const generation = ++updateGeneration;
      return { isCurrent: () => generation === updateGeneration };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("initializes the hidden share manifest data source without login", async () => {
    const { url, encodedManifest } = shareUrl("2026-06-30T10:00:00Z");
    window.history.replaceState(undefined, "", url);

    render(<DeepLinksSyncAdapter deepLinks={[url]} />);

    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith(SHARE_MANIFEST_DATA_SOURCE_ID, {
        type: "connection",
        params: { manifest: encodedManifest },
      });
    });
    expect(mockDataSourceClose).toHaveBeenCalled();
  });

  it("initializes direct shard share manifest URLs without login", async () => {
    const url = directShareUrl("720p");
    window.history.replaceState(undefined, "", url);

    render(<DeepLinksSyncAdapter deepLinks={[url]} />);

    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith(SHARE_MANIFEST_DATA_SOURCE_ID, {
        type: "connection",
        params: {
          manifestUrl: "https://mock-storage.example.com/public/shards/manifest.json",
          layoutUrl: "https://mock-storage.example.com/public/layouts/share.json",
          profile: "720p",
        },
      });
    });
    expect(mockDataSourceClose).toHaveBeenCalled();
  });

  it("drops raw profile from direct shard share manifest URLs", async () => {
    const url = directShareUrl("raw");
    window.history.replaceState(undefined, "", url);

    render(<DeepLinksSyncAdapter deepLinks={[url]} />);

    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith(SHARE_MANIFEST_DATA_SOURCE_ID, {
        type: "connection",
        params: {
          manifestUrl: "https://mock-storage.example.com/public/shards/manifest.json",
          layoutUrl: "https://mock-storage.example.com/public/layouts/share.json",
        },
      });
    });
  });

  it("does not restore a cached project after a newer external update starts", async () => {
    mockCurrentUser = { userId: "user" };
    mockLoginStatus = "alreadyLogin";
    mockLastExternalInitConfig = JSON.stringify({
      warehouseId: "warehouse-a",
      projectId: "project-a",
    });
    let resolveProject: ((project: { name: string }) => void) | undefined;
    mockGetProject.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          resolveProject = resolve;
        }),
    );

    render(<DeepLinksSyncAdapter />);
    await waitFor(() => {
      expect(mockGetProject).toHaveBeenCalledTimes(1);
    });

    mockBeginExternalInitConfigUpdate();
    await act(async () => {
      resolveProject?.({ name: "warehouses/warehouse-a/projects/project-a" });
      await Promise.resolve();
    });

    expect(mockSetExternalInitConfig).not.toHaveBeenCalled();
    expect(mockSetLastExternalInitConfig).not.toHaveBeenCalled();
    expect(mockSetIsReadyForSyncLayout).not.toHaveBeenCalled();
  });

  it("does not release layout sync after stale cached-config cleanup", async () => {
    mockCurrentUser = { userId: "user" };
    mockLoginStatus = "alreadyLogin";
    mockLastExternalInitConfig = "invalid json";
    let resolveCleanup: (() => void) | undefined;
    mockSetLastExternalInitConfig.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      });
    });

    render(<DeepLinksSyncAdapter />);
    await waitFor(() => {
      expect(mockSetLastExternalInitConfig).toHaveBeenCalledWith(undefined);
    });

    mockBeginExternalInitConfigUpdate();
    await act(async () => {
      resolveCleanup?.();
      await Promise.resolve();
    });

    expect(mockSetIsReadyForSyncLayout).not.toHaveBeenCalled();
  });

  it("shows a non-dismissible expired dialog and does not initialize playback", async () => {
    const { url } = shareUrl("2026-06-20T10:00:00Z");
    window.history.replaceState(undefined, "", url);

    render(<DeepLinksSyncAdapter deepLinks={[url]} />);

    await screen.findByText("分享链接已过期");
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(mockSetIsReadyForSyncLayout).not.toHaveBeenCalled();
  });
});
