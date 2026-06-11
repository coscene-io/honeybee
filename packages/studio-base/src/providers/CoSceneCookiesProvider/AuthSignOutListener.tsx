// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";
import { useCookies } from "react-cookie";

import { getAuthStatusCookieName } from "@foxglove/studio-base/util/appConfig";
import { isAuthlessDataSource } from "@foxglove/studio-base/util/coscene";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { AuthStatus } from "./constant";

type AuthStatusCookie = {
  status?: unknown;
  updatedAt?: unknown;
};

type ShouldRedirectForAuthStatusCookieArgs = {
  cookie: unknown;
  mountedAt: number;
  alreadyRedirected: boolean;
  isDesktop: boolean;
  isAuthless: boolean;
};

function parseUpdatedAtMs(updatedAt: unknown): number | undefined {
  if (typeof updatedAt === "number") {
    return Number.isFinite(updatedAt) ? updatedAt : undefined;
  }

  if (typeof updatedAt !== "string") {
    return undefined;
  }

  const trimmedUpdatedAt = updatedAt.trim();

  if (trimmedUpdatedAt.length === 0) {
    return undefined;
  }

  const timestamp = /^\d+$/.test(trimmedUpdatedAt)
    ? Number(trimmedUpdatedAt)
    : Date.parse(trimmedUpdatedAt);

  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isAuthStatusCookie(cookie: unknown): cookie is AuthStatusCookie {
  return cookie != undefined && typeof cookie === "object";
}

export function shouldRedirectForAuthStatusCookie({
  cookie,
  mountedAt,
  alreadyRedirected,
  isDesktop,
  isAuthless,
}: ShouldRedirectForAuthStatusCookieArgs): boolean {
  if (alreadyRedirected || isDesktop || isAuthless || !isAuthStatusCookie(cookie)) {
    return false;
  }

  if (cookie.status !== AuthStatus.SIGN_OUT) {
    return false;
  }

  const updatedAt = parseUpdatedAtMs(cookie.updatedAt);

  return updatedAt != undefined && updatedAt >= mountedAt;
}

function AuthSignOutListener(): React.JSX.Element {
  const authStatusCookieName = getAuthStatusCookieName();
  const [cookies] = useCookies([authStatusCookieName]);
  const authStatusCookie = cookies[authStatusCookieName];
  const mountedAt = useRef(Date.now());
  const redirected = useRef(false);

  useEffect(() => {
    if (
      !shouldRedirectForAuthStatusCookie({
        cookie: authStatusCookie,
        mountedAt: mountedAt.current,
        alreadyRedirected: redirected.current,
        isDesktop: isDesktopApp(),
        isAuthless: isAuthlessDataSource(),
      })
    ) {
      return;
    }

    redirected.current = true;
    window.location.href = `/login?redirectToPath=${encodeURIComponent(
      window.location.pathname + window.location.search,
    )}`;
  }, [authStatusCookie]);

  return <></>;
}

export { AuthSignOutListener };
