// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

interface LogoType {
  logo: string;
  sso_domain: string;
}

declare global {
  interface Window {
    cosConfig: {
      CS_HONEYBEE_BASE_URL?: string;
      GITHUB_SHA?: string;
      IMAGE_TAG?: string;
      LAYOUT_TEMPLATE_INDEX_OSS_URL?: string;
      RELEASE_TAG?: string;
      SENTRY_ENABLED?: boolean;
      SENTRY_HONEYBEE_DSN?: string;
      VITE_APP_BASE_API_PORT?: string;
      VITE_APP_BASE_API_URL?: string;
      VITE_APP_PROJECT_ENV?: string;
      VITE_APP_BFF_URL?: string;
      LOGO_CONFIG?: { [domain: string]: LogoType };
      DEFAULT_TOPIC_PREFIX_OPEN?: string;
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const cosConfig = window.cosConfig ?? {};
export const APP_CONFIG = {
  VITE_APP_BASE_API_PORT:
    cosConfig.VITE_APP_BASE_API_PORT ?? process.env.VITE_APP_BASE_API_PORT ?? "443",
  VITE_APP_BASE_API_URL:
    cosConfig.VITE_APP_BASE_API_URL ??
    process.env.VITE_APP_BASE_API_URL ??
    "https://api.coscene.dev",
  VITE_APP_PROJECT_ENV:
    cosConfig.VITE_APP_PROJECT_ENV ?? process.env.VITE_APP_PROJECT_ENV ?? "local",
  CS_HONEYBEE_BASE_URL:
    cosConfig.CS_HONEYBEE_BASE_URL ?? process.env.CS_HONEYBEE_BASE_URL ?? "http://localhost:8080",
  VITE_APP_BFF_URL:
    cosConfig.VITE_APP_BFF_URL ?? process.env.VITE_APP_BFF_URL ?? "https://bff.coscene.dev",
  IMAGE_TAG: process.env.IMAGE_TAG,
  GITHUB_SHA: process.env.GITHUB_SHA,
  RELEASE_TAG:
    process.env.GITHUB_SHA && process.env.IMAGE_TAG === "latest"
      ? process.env.GITHUB_SHA
      : process.env.IMAGE_TAG,
  LAST_BUILD_TIME: process.env.LAST_BUILD_TIME,
  NPM_PACKAGE_VERSION: process.env.NPM_PACKAGE_VERSION,
  LAYOUT_TEMPLATE_INDEX_OSS_URL:
    cosConfig.LAYOUT_TEMPLATE_INDEX_OSS_URL ??
    process.env.LAYOUT_TEMPLATE_INDEX_OSS_URL ??
    "http://coscene-artifacts-production.oss-cn-hangzhou.aliyuncs.com/honeybee_layouts/dev/index.json",
  SENTRY_HONEYBEE_DSN: cosConfig.SENTRY_HONEYBEE_DSN ?? "",
  SENTRY_ENABLED: cosConfig.SENTRY_ENABLED ?? false,
  LOGO_CONFIG: cosConfig.LOGO_CONFIG ?? {},
  DEFAULT_TOPIC_PREFIX_OPEN: cosConfig.DEFAULT_TOPIC_PREFIX_OPEN ?? "false",
};

window.cosConfig = APP_CONFIG;
