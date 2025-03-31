// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import i18next from "i18next";

import { APP_CONFIG } from "./appConfig";

export function getDocsLink(path?: string): string {
  if (!path) {
    return APP_CONFIG.DOC_BASE_URL;
  }
  const lang = i18next.language === "zh" ? "zh" : "en";

  const env = APP_CONFIG.VITE_APP_PROJECT_ENV;

  const langPrefix = env === "aws" || lang === "zh" ? "" : lang;

  return `${APP_CONFIG.DOC_BASE_URL}${langPrefix}/docs${path}`;
}

export function getLegalDocsLink(type: "terms" | "privacy" | "security"): string {
  const TERMS_DOC_URL = {
    en: `${APP_CONFIG.DOC_BASE_URL}legal/terms/en/terms.html`,
    zh: `${APP_CONFIG.DOC_BASE_URL}legal/terms/zh/terms.html`,
  };

  const PRIVACY_DOC_URL = {
    en: `${APP_CONFIG.DOC_BASE_URL}legal/privacy/en/privacy.html`,
    zh: `${APP_CONFIG.DOC_BASE_URL}legal/privacy/zh/privacy.html`,
  };

  const SECURITY_DOC_URL = {
    en: `${APP_CONFIG.DOC_BASE_URL}security/security-white-paper/en/security-white-paper.html`,
    zh: `${APP_CONFIG.DOC_BASE_URL}security/security-white-paper/zh/security-white-paper.html`,
  };

  const lang = i18next.language === "zh" ? "zh" : "en";

  return {
    terms: TERMS_DOC_URL[lang],
    privacy: PRIVACY_DOC_URL[lang],
    security: SECURITY_DOC_URL[lang],
  }[type];
}
