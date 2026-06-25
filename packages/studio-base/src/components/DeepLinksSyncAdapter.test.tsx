/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen, waitFor } from "@testing-library/react";

import { DeepLinksSyncAdapter } from "@foxglove/studio-base/components/DeepLinksSyncAdapter";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const mockSelectSource = jest.fn();
const mockSelectEvent = jest.fn();
const mockSetIsReadyForSyncLayout = jest.fn();
const mockSetLastExternalInitConfig = jest.fn();
const mockDataSourceClose = jest.fn();

jest.mock("@foxglove/studio-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ selectSource: mockSelectSource }),
}));

jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (store: unknown) => unknown) =>
    selector({ user: undefined, loginStatus: "notLogin" }),
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
    selector({ setIsReadyForSyncLayout: mockSetIsReadyForSyncLayout }),
}));

jest.mock("@foxglove/studio-base/hooks", () => ({
  useAppConfigurationValue: () => [undefined, mockSetLastExternalInitConfig],
}));

jest.mock("@foxglove/studio-base/components/CoreDataSyncAdapter", () => ({
  useSetExternalInitConfig: () => jest.fn(),
}));

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({ getProject: jest.fn() }),
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
    expires_at: expiresAt,
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

describe("<DeepLinksSyncAdapter /> share manifest handling", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-06-25T00:00:00Z") });
    mockSelectSource.mockClear();
    mockSelectEvent.mockClear();
    mockSetIsReadyForSyncLayout.mockClear();
    mockSetLastExternalInitConfig.mockClear();
    mockDataSourceClose.mockClear();
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

  it("shows a non-dismissible expired dialog and does not initialize playback", async () => {
    const { url } = shareUrl("2026-06-20T10:00:00Z");
    window.history.replaceState(undefined, "", url);

    render(<DeepLinksSyncAdapter deepLinks={[url]} />);

    await screen.findByText("分享链接已过期");
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(mockSetIsReadyForSyncLayout).not.toHaveBeenCalled();
  });
});
