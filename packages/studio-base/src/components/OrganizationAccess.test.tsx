/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import {
  fetchOrganizationAccess,
  getOrganizationSwitchUrl,
  OrganizationAccessView,
} from "@foxglove/studio-web/src/OrganizationAccess";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("preserves the complete link and the selected organization", () => {
  window.history.replaceState(undefined, "", "/viz?ds.key=key&layoutId=layout&time=123#panel");
  const url = new URL(getOrganizationSwitchUrl({ name: "organizations/abc", displayName: "A" }));
  expect(url.pathname).toBe("/switch-organization");
  expect(url.searchParams.get("returnTo")).toBe("/viz?ds.key=key&layoutId=layout&time=123#panel");
  expect(url.searchParams.get("organization")).toBe("organizations/abc");
});

it.each([
  [401, "login"],
  [403, "denied"],
  [404, "unavailable"],
])("classifies HTTP %s without inventing an organization", async (status, expected) => {
  globalThis.fetch = jest.fn().mockResolvedValue({ status, ok: false });
  const result = await fetchOrganizationAccess(
    "https://api.example",
    "key",
    "Bearer test",
    new AbortController().signal,
  );
  expect(result).toEqual({ status: expected });
});

it("does not issue an unauthenticated metadata request", async () => {
  globalThis.fetch = jest.fn();
  expect(await fetchOrganizationAccess("", "key", "", new AbortController().signal)).toEqual({
    status: "login",
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("rejects an unverified mismatch response", async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ status: "organization-mismatch" }) });
  await expect(
    fetchOrganizationAccess("", "key", "Bearer test", new AbortController().signal),
  ).rejects.toThrow("Invalid organization");
});

it("keeps the changed-organization dialog open on Escape", () => {
  render(
    <OrganizationAccessView
      access={{
        status: "organization-mismatch",
        organization: { name: "organizations/a", displayName: "A" },
        currentOrganization: { name: "organizations/b", displayName: "B" },
      }}
      changed
      modal
      onRetry={jest.fn()}
    />,
  );
  expect(screen.getByText("Link organization: A")).not.toBeNull();
  expect(screen.getByText("Current organization: B")).not.toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Switch back and continue" })).not.toBeNull();
});

it("offers an inline retry for network failure", () => {
  const retry = jest.fn();
  render(
    <OrganizationAccessView
      access={{ status: "error" }}
      changed={false}
      modal={false}
      onRetry={retry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
