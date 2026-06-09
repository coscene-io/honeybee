// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

export enum AuthStatus {
  LOGGED_IN = "LOGGED_IN",
  SIGN_OUT = "SIGN_OUT",
}

export const AUTH_STATUS_COOKIE_MAX_AGE_SECONDS = 1800;

type AuthStatusCookieOptions = {
  path: "/";
  domain: string;
  secure: true;
  sameSite: "none";
  maxAge: number;
};

type LegacyAuthStatusCookieCleanupOptions = AuthStatusCookieOptions & {
  name: string;
  maxAge: 0;
};

const sameSite = "none";

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getFallbackParentCookieDomain(hostname = getCurrentHostname()): string | undefined {
  if (!hostname || isLocalHostname(hostname)) {
    return undefined;
  }

  const parts = hostname.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  return parts.slice(-2).join(".");
}

function getCurrentHostname(): string {
  return typeof window !== "undefined" ? window.location.hostname : "";
}

function normalizeCookieDomain(domain: string): string {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

export function getCookieSetOptions(): AuthStatusCookieOptions {
  const domainConfig = getDomainConfig();

  return {
    path: "/",
    domain: normalizeCookieDomain(domainConfig.authStatusCookieDomain),
    secure: true,
    sameSite,
    maxAge: AUTH_STATUS_COOKIE_MAX_AGE_SECONDS,
  };
}

export function getLegacyAuthStatusCookieCleanupOptions(
  hostname = getCurrentHostname(),
): LegacyAuthStatusCookieCleanupOptions | undefined {
  const domainConfig = getDomainConfig();
  const configuredDomain = normalizeCookieDomain(domainConfig.authStatusCookieDomain);
  const fallbackParentDomain = getFallbackParentCookieDomain(hostname);

  if (configuredDomain.length === 0 || fallbackParentDomain == undefined) {
    return undefined;
  }

  const normalizedFallbackParentDomain = normalizeCookieDomain(fallbackParentDomain);

  if (
    normalizedFallbackParentDomain.length === 0 ||
    configuredDomain === normalizedFallbackParentDomain
  ) {
    return undefined;
  }

  return {
    name: domainConfig.authStatusCookieName,
    path: "/",
    domain: normalizedFallbackParentDomain,
    secure: true,
    sameSite,
    maxAge: 0,
  };
}

export function cleanupLegacyAuthStatusCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  const cleanupOptions = getLegacyAuthStatusCookieCleanupOptions();

  if (!cleanupOptions) {
    return;
  }

  document.cookie = [
    `${cleanupOptions.name}=`,
    `Max-Age=${cleanupOptions.maxAge}`,
    `path=${cleanupOptions.path}`,
    `domain=${cleanupOptions.domain}`,
    `SameSite=${cleanupOptions.sameSite}`,
    "Secure",
  ]
    .filter(Boolean)
    .join("; ");
}
