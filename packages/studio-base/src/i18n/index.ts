// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  enPreferences,
  enDataSource,
  enLayouts,
  enAddPanel,
  enPanelSetting,
  enStudioLogsSettings,
  enAccount,
  enCommon,
  enDiagnostic,
  enPublish,
  enUserScript,
  enMoment,
  enGeneral,
  enError,
  enThreeDimensionalPanel,
} from "./en";
import {
  zhPreferences,
  zhDataSource,
  zhLayouts,
  zhAddPanel,
  zhPanelSetting,
  zhStudioLogsSettings,
  zhAccount,
  zhCommon,
  zhDiagnostic,
  zhPublish,
  zhUserScript,
  zhMoment,
  zhGeneral,
  zhError,
  zhThreeDimensionalPanel,
} from "./zh";

export const translations = {
  en: {
    account: enAccount,
    addPanel: enAddPanel,
    common: enCommon,
    dataSource: enDataSource,
    diagnostic: enDiagnostic,
    layouts: enLayouts,
    panelSetting: enPanelSetting,
    preferences: enPreferences,
    publish: enPublish,
    studioLogsSettings: enStudioLogsSettings,
    userScript: enUserScript,
    moment: enMoment,
    general: enGeneral,
    error: enError,
    threeDimensionalPanel: enThreeDimensionalPanel,
  },
  zh: {
    account: zhAccount,
    addPanel: zhAddPanel,
    common: zhCommon,
    dataSource: zhDataSource,
    diagnostic: zhDiagnostic,
    layouts: zhLayouts,
    panelSetting: zhPanelSetting,
    preferences: zhPreferences,
    publish: zhPublish,
    studioLogsSettings: zhStudioLogsSettings,
    userScript: zhUserScript,
    moment: zhMoment,
    general: zhGeneral,
    error: zhError,
    threeDimensionalPanel: zhThreeDimensionalPanel,
  },
};

export type Language = keyof typeof translations;

export const defaultNS = "general";

export async function initI18n(): Promise<void> {
  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: translations,
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
      },
      fallbackLng: "en",
      defaultNS,
    });
}
