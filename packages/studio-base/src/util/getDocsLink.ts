// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import i18next from "i18next";

import { getAppConfig } from "./appConfig";

export function getDocsLink(path?: string): string {
  const lang = i18next.language === "zh" ? "zh" : "en";

  const appConfig = getAppConfig();
  const env = appConfig.VITE_APP_PROJECT_ENV;
  let url = appConfig.DOC_BASE_URL ?? "";

  const langPrefix = env === "aws" || env === "gcp" || lang === "zh" ? "" : lang;
  if (langPrefix) {
    url += `/${langPrefix}`;
  }
  if (path) {
    url += "/docs";
    if (!path.startsWith("/")) {
      url += "/";
    }
    url += path;
  }
  return url;
}

export function getLegalDocsLink(type: "terms" | "privacy" | "security"): string {
  const appConfig = getAppConfig();

  const TERMS_DOC_URL = {
    en: `${appConfig.DOC_BASE_URL}/legal/terms/en/terms.html`,
    zh: `${appConfig.DOC_BASE_URL}/legal/terms/zh/terms.html`,
  };

  const PRIVACY_DOC_URL = {
    en: `${appConfig.DOC_BASE_URL}/legal/privacy/en/privacy.html`,
    zh: `${appConfig.DOC_BASE_URL}/legal/privacy/zh/privacy.html`,
  };

  const SECURITY_DOC_URL = {
    en: `${appConfig.DOC_BASE_URL}/security/security-white-paper/en/security-white-paper.html`,
    zh: `${appConfig.DOC_BASE_URL}/security/security-white-paper/zh/security-white-paper.html`,
  };

  const lang = i18next.language === "zh" ? "zh" : "en";

  return {
    terms: TERMS_DOC_URL[lang],
    privacy: PRIVACY_DOC_URL[lang],
    security: SECURITY_DOC_URL[lang],
  }[type];
}
