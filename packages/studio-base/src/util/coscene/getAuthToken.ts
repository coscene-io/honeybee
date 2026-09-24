// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ACCESS_TOKEN_NAME } from "@foxglove/studio-base/util/queries";

/**
 * Per-organization token cache written by the coScene web app.
 * Honeybee only reads this store; the web app owns writes and eviction.
 */
export const ORG_TOKENS_STORAGE_KEY = "coScene_org_tokens_v1";

/** URL query parameter carrying the active organization id when web opens /viz. */
export const ORG_ID_QUERY_PARAM = "orgId";

type OrgTokenEntry = {
  token?: unknown;
  orgSlug?: unknown;
  expiresAtMs?: unknown;
  storedAtMs?: unknown;
};

function getActiveOrgId(): string | undefined {
  const orgId = new URLSearchParams(window.location.search).get(ORG_ID_QUERY_PARAM);
  return orgId == undefined || orgId.length === 0 ? undefined : orgId;
}

function getOrgScopedToken(orgId: string): string | undefined {
  let entry: OrgTokenEntry | undefined;
  try {
    const raw = localStorage.getItem(ORG_TOKENS_STORAGE_KEY);
    if (raw == undefined) {
      return undefined;
    }
    entry = (JSON.parse(raw) as undefined | Record<string, OrgTokenEntry | undefined>)?.[orgId];
  } catch {
    // A malformed store must not break auth; the legacy slot still works.
    return undefined;
  }

  const token = entry?.token;
  if (typeof token !== "string" || token.length === 0) {
    return undefined;
  }
  if (typeof entry?.expiresAtMs === "number" && entry.expiresAtMs <= Date.now()) {
    return undefined;
  }
  return token;
}

/**
 * Resolve the auth token for the organization this page is working in.
 *
 * When the URL carries an `orgId` (added by the web app when it opens /viz), the token for
 * that organization is looked up in the per-org token cache. Otherwise — or when the cache
 * has no usable token for that organization — this falls back to the legacy single-slot
 * `coScene_org_jwt`, matching the previous behavior (desktop and older web deployments
 * always take the fallback path).
 */
export function getAuthToken(): string | undefined {
  const orgId = getActiveOrgId();
  if (orgId != undefined) {
    const token = getOrgScopedToken(orgId);
    if (token != undefined) {
      return token;
    }
  }
  return localStorage.getItem(ACCESS_TOKEN_NAME) ?? undefined;
}
