/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getDomainConfig } from "./appConfig";

describe("getDomainConfig", () => {
  const defaultDomainConfig = {
    env: "saas",
    logo: "coscene",
    authStatusCookieName: "coSceneAuthStatus",
    authStatusCookieDomain: "coscene.cn",
    webDomain: "coscene.cn",
    ssoDomain: "sso.coscene.cn",
  };

  const agibotDomainConfig = {
    env: "saas",
    logo: "agibot",
    authStatusCookieName: "agibotAuthStatus",
    authStatusCookieDomain: "coscene.cn",
    webDomain: "agibot.coscene.cn",
    ssoDomain: "agibot.sso.coscene.cn",
  };

  afterEach(() => {
    window.cosConfig = undefined;
    window.cosConfigRemoteHostname = undefined;
  });

  it("uses the remote config hostname when the window hostname does not match a domain config", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: defaultDomainConfig,
        "agibot.coscene.cn": agibotDomainConfig,
      },
    };
    window.cosConfigRemoteHostname = "agibot.coscene.cn";

    expect(getDomainConfig().webDomain).toEqual("agibot.coscene.cn");
  });

  it("falls back to the default domain config when there is no remote hostname match", () => {
    window.cosConfig = {
      DOMAIN_CONFIG: {
        default: defaultDomainConfig,
        "agibot.coscene.cn": agibotDomainConfig,
      },
    };
    window.cosConfigRemoteHostname = "unknown.coscene.cn";

    expect(getDomainConfig().webDomain).toEqual("coscene.cn");
  });
});
