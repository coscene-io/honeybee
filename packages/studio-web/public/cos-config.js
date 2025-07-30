// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

window.cosConfig = {
  COORDINATOR_URL: "https://coordinator.staging.coscene.cn",
  CS_HONEYBEE_BASE_URL: "https://viz.staging.coscene.cn",
  DOC_BASE_URL: "https://docs.coscene.cn",
  DOMAIN_CONFIG: {
    default: {
      authStatusCookieDomain: "staging.coscene.cn",
      authStatusCookieName: "coSceneAuthStatusStaging",
      env: "staging",
      logo: "coscene",
      ssoDomain: "sso.staging.coscene.cn",
      webDomain: "staging.coscene.cn",
    },
    "web.staging.coscene.cn": {
      authStatusCookieDomain: "staging.coscene.cn",
      authStatusCookieName: "suporAuthStatusStaging",
      env: "staging",
      logo: "supor",
      ssoDomain: "web.sso.staging.coscene.cn",
      webDomain: "web.staging.coscene.cn",
    },
  },
  FEATURE_FLAG_GROWTHBOOK: {
    authorize_device: false,
    cyber_converter: false,
    diagnosis_rule: false,
    mesh_network_config: {
      api_url: "",
      enabled: false,
    },
    record_intelligent_analytics: false,
  },
  GROWTHBOOK_API_HOST: "https://ff-proxy.coscene.site",
  GROWTHBOOK_CLIENT_KEY: "sdk-DzRxfnx5CUkuKGBg",
  GROWTHBOOK_ENABLED: true,
  INVITE_USER_METHOD: "phone",
  LANGUAGE: {
    default: "zh",
    options: ["en", "zh"],
  },
  MATRIX_HOST: "matrix.staging.coscene.cn",
  OFFICIAL_WEB_URL: "https://www.coscene.cn",
  POSTHOG: {
    api_host: "https://posthog.coscene.site",
    enabled: true,
    token: "phc_Toi3ks6md0takiQhnpFeB7bxlVbrWsea1MZB3NSpNvU",
  },
  SENTRY_AUTH_TOKEN: "5d7fd483a3c5412f80bc5ce61fcad735868109e4c221498f97c34c39fac24e12",
  SENTRY_DSN: "https://0adc9bf1de394108b5e22679cff97123@sentry.coscene.site/4",
  SENTRY_ENABLED: true,
  VITE_APP_BASE_API_PORT: 443,
  VITE_APP_BASE_API_URL: "https://api.staging.coscene.cn",
  VITE_APP_BFF_URL: "https://bff.staging.coscene.cn",
  VITE_APP_BFF_WS_URL: "wss://bff.staging.coscene.cn",
  VITE_APP_CR_DOMAIN: "cr.staging.coscene.cn",
  VITE_APP_PROJECT_ENV: "staging",
};
