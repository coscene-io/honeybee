/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getAuthToken, ORG_TOKENS_STORAGE_KEY } from "./getAuthToken";

const ORG_ID = "45d76d5e-7ee2-449a-91bf-51545fb8cc24";
const ORG_TOKEN = "Bearer org-scoped-jwt";
const LEGACY_TOKEN = "Bearer legacy-jwt";

function setSearch(search: string) {
  window.history.replaceState(undefined, "", `/viz${search}`);
}

function setOrgTokenEntry(entry: Record<string, unknown>) {
  localStorage.setItem(ORG_TOKENS_STORAGE_KEY, JSON.stringify({ [ORG_ID]: entry }) ?? "");
}

describe("getAuthToken", () => {
  beforeEach(() => {
    localStorage.clear();
    setSearch("");
  });

  it("returns the org-scoped token when the URL orgId hits the keyed store", () => {
    setSearch(`?ds=coscene-data-platform&orgId=${ORG_ID}`);
    localStorage.setItem("coScene_org_jwt", LEGACY_TOKEN);
    setOrgTokenEntry({
      token: ORG_TOKEN,
      orgSlug: "acme",
      expiresAtMs: Date.now() + 60_000,
      storedAtMs: Date.now(),
    });

    expect(getAuthToken()).toBe(ORG_TOKEN);
  });

  it("falls back to the legacy slot when the URL has no orgId", () => {
    localStorage.setItem("coScene_org_jwt", LEGACY_TOKEN);
    setOrgTokenEntry({ token: ORG_TOKEN, expiresAtMs: Date.now() + 60_000 });

    expect(getAuthToken()).toBe(LEGACY_TOKEN);
  });

  it("falls back to the legacy slot when the keyed store has no entry for the orgId", () => {
    setSearch(`?orgId=${ORG_ID}`);
    localStorage.setItem("coScene_org_jwt", LEGACY_TOKEN);
    localStorage.setItem(
      ORG_TOKENS_STORAGE_KEY,
      JSON.stringify({ "other-org": { token: "x" } }) ?? "",
    );

    expect(getAuthToken()).toBe(LEGACY_TOKEN);
  });

  it("ignores an expired org-scoped token", () => {
    setSearch(`?orgId=${ORG_ID}`);
    localStorage.setItem("coScene_org_jwt", LEGACY_TOKEN);
    setOrgTokenEntry({ token: ORG_TOKEN, expiresAtMs: Date.now() - 1 });

    expect(getAuthToken()).toBe(LEGACY_TOKEN);
  });

  it("treats a missing expiresAtMs as not expired", () => {
    setSearch(`?orgId=${ORG_ID}`);
    setOrgTokenEntry({ token: ORG_TOKEN });

    expect(getAuthToken()).toBe(ORG_TOKEN);
  });

  it("falls back to the legacy slot when the keyed store is malformed JSON", () => {
    setSearch(`?orgId=${ORG_ID}`);
    localStorage.setItem("coScene_org_jwt", LEGACY_TOKEN);
    localStorage.setItem(ORG_TOKENS_STORAGE_KEY, "not-json{");

    expect(getAuthToken()).toBe(LEGACY_TOKEN);
  });

  it("returns undefined when nothing is stored at all", () => {
    expect(getAuthToken()).toBeUndefined();
  });
});
