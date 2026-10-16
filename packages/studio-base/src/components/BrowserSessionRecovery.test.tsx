/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, waitFor } from "@testing-library/react";

import {
  BrowserSession,
  getBrowserAuthUrl,
  initializeBrowserSession,
} from "@foxglove/studio-base/util/browserSession";
import { fetchOrganizationAccess } from "@foxglove/studio-web/src/OrganizationAccess";
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
jest.mock("@foxglove/studio-base/StudioApp", () => ({
  StudioApp: () => <div data-testid="workspace" />,
}));
jest.mock("@foxglove/studio-web/src/CoSceneInit", () => ({ useCoSceneInit: jest.fn() }));
jest.mock("@foxglove/studio-web/src/services/LocalStorageAppConfiguration", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  initializeBrowserSession: jest.fn(),
  getBrowserAuthUrl: jest.fn(
    jest.requireActual<typeof import("@foxglove/studio-base/util/browserSession")>(
      "@foxglove/studio-base/util/browserSession",
    ).getBrowserAuthUrl,
  ),
}));

jest.mock("@foxglove/studio-web/src/OrganizationAccess", () => ({
  ...jest.requireActual("@foxglove/studio-web/src/OrganizationAccess"),
  fetchOrganizationAccess: jest.fn().mockResolvedValue({ status: "ready" }),
}));

beforeEach(() => {
  jest
    .mocked(getBrowserAuthUrl)
    .mockImplementation(
      jest.requireActual<typeof import("@foxglove/studio-base/util/browserSession")>(
        "@foxglove/studio-base/util/browserSession",
      ).getBrowserAuthUrl,
    );
  jest.mocked(fetchOrganizationAccess).mockResolvedValue({ status: "ready" });
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
      localStorage.setItem(
        "coscene.auth.session-version.v1",
        JSON.stringify({
          version: "ab".repeat(16),
          reason: "logout",
          signOutPendingUntilMs: 0,
          isServerSignOutConfirmed: true,
        }) ?? "",
      );
      localStorage.removeItem("coScene_org_jwt");
      session.reconcile();
    }
  });
  const link = screen.getByRole("link", { name: "Open sign-in recovery" });
  const href = new URL(link.getAttribute("href")!, window.location.origin);
  expect(href.pathname).toBe(path);
  expect(href.searchParams.get("redirectToPath")).toBe(returnTo);
  expect(screen.queryByTestId("workspace")).toBeNull();
});

it("offers explicit continuation after replacement without adopting the new token", async () => {
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  act(() => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    window.dispatchEvent(new StorageEvent("storage", { key: "coScene_org_jwt" }));
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Continue viewing" })).not.toBeNull();
  });
  expect(session.credential).toBe("Bearer initial");
  expect(screen.queryByTestId("workspace")).toBeNull();
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
  expect(screen.getByTestId("workspace")).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Open sign-in recovery" })).toBeNull();
});

it("keeps public playback mounted when a peer replaces the protected session", () => {
  const hash = new URLSearchParams({ manifestUrl: "https://storage.example/manifest.json" });
  window.history.replaceState(undefined, "", `/viz?ds=coscene-share-manifest#${hash.toString()}`);
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  act(() => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    window.dispatchEvent(new StorageEvent("storage", { key: "coScene_org_jwt" }));
  });
  expect(session.getStatus()).toBe("changed");
  expect(session.controller.signal.aborted).toBe(true);
  expect(session.preservesPlayback()).toBe(true);
  expect(session.credential).toBe("Bearer initial");
  expect(screen.getByTestId("workspace")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
});

it.each(["/", "/viz/"])("keeps local playback mounted on the %s build after expiry", (basePath) => {
  const previousBasePath = process.env.HONEYBEE_WEB_PUBLIC_PATH;
  process.env.HONEYBEE_WEB_PUBLIC_PATH = basePath;
  window.history.replaceState(undefined, "", basePath);
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  try {
    render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
    const workspace = screen.getByTestId("workspace");
    act(() => {
      session.setLocalPlayback({ local: true });
      session.rejectCredential("Bearer initial");
    });
    expect(session.getStatus()).toBe("recover");
    expect(screen.getByTestId("workspace")).toBe(workspace);
    expect(screen.queryByRole("link", { name: "Open sign-in recovery" })).toBeNull();
    expect(window.location.pathname).toBe(basePath);
  } finally {
    if (previousBasePath == undefined) {
      delete process.env.HONEYBEE_WEB_PUBLIC_PATH;
    } else {
      process.env.HONEYBEE_WEB_PUBLIC_PATH = previousBasePath;
    }
  }
});

it("checks access before mounting a private workspace and repeats the check after a session change", async () => {
  const session = new BrowserSession();
  jest.mocked(initializeBrowserSession).mockReturnValue(session);
  const access = jest.mocked(fetchOrganizationAccess);
  access.mockResolvedValueOnce({ status: "ready" }).mockResolvedValueOnce({
    status: "organization-mismatch",
    organization: { name: "organizations/a", displayName: "A" },
    currentOrganization: { name: "organizations/b", displayName: "B" },
  });
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  expect(screen.queryByTestId("workspace")).toBeNull();
  await waitFor(() => {
    expect(screen.getByTestId("workspace")).not.toBeNull();
  });
  act(() => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    session.reconcile();
  });
  await screen.findByRole("dialog");
  await screen.findByRole("button", { name: "Switch back to A and continue" });
  expect(session.controller.signal.aborted).toBe(true);
  expect(screen.getByTestId("workspace").parentElement?.style.display).toBe("none");
  expect(access).toHaveBeenLastCalledWith(
    expect.any(String),
    "record",
    "Bearer replacement",
    expect.any(AbortSignal),
  );
});

it("does not mount private data or layout providers for a mismatched link", async () => {
  jest.mocked(fetchOrganizationAccess).mockResolvedValue({
    status: "organization-mismatch",
    organization: { name: "organizations/b", displayName: "B" },
  });
  jest.mocked(initializeBrowserSession).mockReturnValue(new BrowserSession());
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  await screen.findByRole("button", { name: "Switch to B and open" });
  expect(screen.queryByTestId("workspace")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("automatically starts fresh login before mounting a private link without credentials", () => {
  localStorage.removeItem("coScene_org_jwt");
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  let destination = "";
  const actual = jest.requireActual<typeof import("@foxglove/studio-base/util/browserSession")>(
    "@foxglove/studio-base/util/browserSession",
  );
  jest.mocked(getBrowserAuthUrl).mockImplementation((path) => {
    destination = actual.getBrowserAuthUrl(path);
    // Hash navigation is supported in jsdom, unlike a cross-document redirect.
    return "#fresh-login";
  });
  jest.mocked(initializeBrowserSession).mockReturnValue(new BrowserSession());
  jest.mocked(fetchOrganizationAccess).mockClear();
  render(<WebRoot extraProviders={undefined} dataSources={undefined} />);
  expect(window.location.hash).toBe("#fresh-login");
  const target = new URL(destination, window.location.origin);
  expect(target.pathname).toBe("/auth/login");
  expect(target.searchParams.get("redirectToPath")).toBe(returnTo);
  expect(fetchOrganizationAccess).not.toHaveBeenCalled();
  expect(screen.queryByTestId("workspace")).toBeNull();
});
