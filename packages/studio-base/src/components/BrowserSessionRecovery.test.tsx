/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";

import {
  BrowserSession,
  initializeBrowserSession,
} from "@foxglove/studio-base/util/browserSession";
import { WebRoot } from "@foxglove/studio-web/src/WebRoot";

jest.mock("@foxglove/studio-base", () => ({
  AppSetting: { SHOW_DEBUG_PANELS: "debug" },
  SharedProviders: () => [],
  SharedRoot: ({ children }: React.PropsWithChildren) => <div data-testid="studio">{children}</div>,
  ConsoleApi: jest.fn(),
  IdbExtensionLoader: jest.fn(),
  CoSceneDataPlatformDataSourceFactory: jest.fn(),
  CoSceneShareManifestDataSourceFactory: jest.fn(),
  FoxgloveWebSocketDataSourceFactory: jest.fn(),
  RemoteMp4DataSourceFactory: jest.fn(),
  PersistentCacheDataSourceFactory: jest.fn(),
}));
jest.mock("@foxglove/studio-base/StudioApp", () => ({ StudioApp: () => ReactNull }));
jest.mock("@foxglove/studio-web/src/CoSceneInit", () => ({ useCoSceneInit: jest.fn() }));
jest.mock("@foxglove/studio-web/src/services/LocalStorageAppConfiguration", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  initializeBrowserSession: jest.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("coScene_org_jwt", "Bearer initial");
  window.history.replaceState(
    undefined,
    "",
    "/viz?ds=coscene-data-platform&ds.key=record&layoutId=layout&time=2025-04-07T02%3A08%3A22.721000000Z#detail",
  );
});

it.each([
  { status: "recover", path: "/auth/recover" },
  { status: "logged-out", path: "/auth/logged-out" },
])("keeps the complete deep link when opening $status", ({ status, path }) => {
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  act(() => {
    if (status === "recover") {
      session.rejectCredential("Bearer initial");
    } else {
      session.observeSignOutBroadcast();
    }
  });
  const link = screen.getByRole("link", { name: "Open sign-in recovery" });
  const href = new URL(link.getAttribute("href")!, window.location.origin);
  expect(href.pathname).toBe(path);
  expect(href.searchParams.get("redirectToPath")).toBe(returnTo);
  expect(screen.queryByTestId("studio")).toBeNull();
});

it("offers reload after replacement without adopting the new token", () => {
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  act(() => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    window.dispatchEvent(new StorageEvent("storage", { key: "coScene_org_jwt" }));
  });
  expect(screen.getByRole("button", { name: "Reload" })).not.toBeNull();
  expect(session.credential).toBe("Bearer initial");
  expect(screen.queryByTestId("studio")).toBeNull();
});

it("renders a public share despite a rejected account token", () => {
  sessionStorage.setItem("coScene_invalid_org_jwt", "Bearer initial");
  const hash = new URLSearchParams({ manifestUrl: "https://storage.example/manifest.json" });
  window.history.replaceState(undefined, "", `/viz?ds=coscene-share-manifest#${hash.toString()}`);
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  expect(session.getStatus()).toBe("recover");
  expect(session.preservesPlayback()).toBe(true);
  expect(screen.getByTestId("studio")).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Open sign-in recovery" })).toBeNull();
});
