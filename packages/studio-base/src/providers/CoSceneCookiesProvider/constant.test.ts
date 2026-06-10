/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AUTH_STATUS_COOKIE_MAX_AGE_SECONDS,
  getCookieSetOptions,
  getLegacyAuthStatusCookieCleanupOptions,
} from "./constant";

const defaultDomainConfig = {
  env: "saas",
  logo: "coscene",
  authStatusCookieName: "coSceneAuthStatus",
  authStatusCookieDomain: "coscene.cn",
  webDomain: "coscene.cn",
  ssoDomain: "sso.coscene.cn",
};

const volcDomainConfig = {
  env: "volc",
  logo: "coscene",
  authStatusCookieName: "coSceneVolcAuthStatus",
  authStatusCookieDomain: "volc.coscene.cn",
  webDomain: "volc.coscene.cn",
  ssoDomain: "volc.sso.coscene.cn",
};

describe("CoScene auth status cookie options", () => {
  afterEach(() => {
    window.cosConfig = undefined;
    window.cosConfigRemoteHostname = undefined;
  });

  it("uses the configured auth status cookie domain instead of the parent domain fallback", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: defaultDomainConfig,
        "volc.coscene.cn": volcDomainConfig,
      },
    };
    window.cosConfigRemoteHostname = "volc.coscene.cn";

    expect(getCookieSetOptions()).toEqual({
      path: "/",
      domain: "volc.coscene.cn",
      secure: true,
      sameSite: "none",
      maxAge: AUTH_STATUS_COOKIE_MAX_AGE_SECONDS,
    });
  });

  it("expires the legacy parent-domain auth status cookie when configured domain differs", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: defaultDomainConfig,
        "volc.coscene.cn": volcDomainConfig,
      },
    };
    window.cosConfigRemoteHostname = "volc.coscene.cn";

    expect(getLegacyAuthStatusCookieCleanupOptions("volc.coscene.cn")).toEqual({
      name: "coSceneVolcAuthStatus",
      path: "/",
      domain: "coscene.cn",
      secure: true,
      sameSite: "none",
      maxAge: 0,
    });
  });

  it("does not expire a parent-domain cookie when it is also the configured domain", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: defaultDomainConfig,
      },
    };

    expect(getLegacyAuthStatusCookieCleanupOptions("www.coscene.cn")).toBeUndefined();
  });

  it("does not produce a legacy cleanup domain for local hostnames", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: {
          ...defaultDomainConfig,
          authStatusCookieDomain: "localhost",
        },
      },
    };

    expect(getLegacyAuthStatusCookieCleanupOptions("127.0.0.1")).toBeUndefined();
  });
});
