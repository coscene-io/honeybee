/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { shouldRedirectForAuthStatusCookie } from "./AuthSignOutListener";
import { AuthStatus } from "./constant";

describe("shouldRedirectForAuthStatusCookie", () => {
  const mountedAt = 1_000;

  it("ignores stale SIGN_OUT cookies that predate listener mount", () => {
    expect(
      shouldRedirectForAuthStatusCookie({
        cookie: { status: AuthStatus.SIGN_OUT, updatedAt: mountedAt - 1 },
        mountedAt,
        alreadyRedirected: false,
        isDesktop: false,
        isAuthless: false,
      }),
    ).toBe(false);
  });

  it("ignores SIGN_OUT cookies with missing or invalid updatedAt", () => {
    expect(
      shouldRedirectForAuthStatusCookie({
        cookie: { status: AuthStatus.SIGN_OUT },
        mountedAt,
        alreadyRedirected: false,
        isDesktop: false,
        isAuthless: false,
      }),
    ).toBe(false);

    expect(
      shouldRedirectForAuthStatusCookie({
        cookie: { status: AuthStatus.SIGN_OUT, updatedAt: "not-a-date" },
        mountedAt,
        alreadyRedirected: false,
        isDesktop: false,
        isAuthless: false,
      }),
    ).toBe(false);
  });

  it("redirects for new SIGN_OUT cookies only once", () => {
    const cookie = { status: AuthStatus.SIGN_OUT, updatedAt: mountedAt };

    expect(
      shouldRedirectForAuthStatusCookie({
        cookie,
        mountedAt,
        alreadyRedirected: false,
        isDesktop: false,
        isAuthless: false,
      }),
    ).toBe(true);

    expect(
      shouldRedirectForAuthStatusCookie({
        cookie,
        mountedAt,
        alreadyRedirected: true,
        isDesktop: false,
        isAuthless: false,
      }),
    ).toBe(false);
  });

  it("keeps the existing desktop and authless skip behavior", () => {
    const cookie = { status: AuthStatus.SIGN_OUT, updatedAt: mountedAt };

    expect(
      shouldRedirectForAuthStatusCookie({
        cookie,
        mountedAt,
        alreadyRedirected: false,
        isDesktop: true,
        isAuthless: false,
      }),
    ).toBe(false);

    expect(
      shouldRedirectForAuthStatusCookie({
        cookie,
        mountedAt,
        alreadyRedirected: false,
        isDesktop: false,
        isAuthless: true,
      }),
    ).toBe(false);
  });
});
