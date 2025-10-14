// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import * as cosEn from "./cosEn";
import * as cosZh from "./cosZh";
import * as en from "./en";
import * as ja from "./ja";
import * as zh from "./zh";
import { getAppConfig } from "../util/appConfig";

export const translations: {
  en: typeof en & typeof cosEn;
  zh: typeof zh & typeof cosZh;
  ja: typeof ja;
} = {
  en: {
    ...en,
    ...cosEn,
  },
  zh: {
    ...zh,
    ...cosZh,
  },
  ja,
};

export type Language = keyof typeof translations;

export const defaultNS = "general";

export async function initI18n(options?: { context?: "browser" | "electron-main" }): Promise<void> {
  const { context = "browser" } = options ?? {};
  if (context === "browser") {
    i18n.use(initReactI18next);
    i18n.use(LanguageDetector);
  }

  const appConfig = getAppConfig();

  await i18n.init({
    lng: appConfig.LANGUAGE?.options.length === 1 ? appConfig.LANGUAGE.default : undefined,
    resources: translations,
    detection:
      context === "browser" &&
      appConfig.LANGUAGE?.options.length != undefined &&
      appConfig.LANGUAGE.options.length > 1
        ? { order: ["localStorage"], caches: ["localStorage"] }
        : undefined,
    fallbackLng: appConfig.LANGUAGE?.default,
    defaultNS,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
  });
}
