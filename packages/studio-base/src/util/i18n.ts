// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { translations } from "@foxglove/studio-base/locales";

export const defaultNS = "general";

const DETECTION_OPTIONS = {
  order: ["localStorage", "navigator"],
  caches: ["localStorage"],
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: translations,
    detection: DETECTION_OPTIONS,
    fallbackLng: "en",
    defaultNS,

    interpolation: {
      escapeValue: false,
      prefix: "{{",
      suffix: "}}",
    },
  })
  .catch((err) => {
    console.error("Failed to initialize i18n", err);
  });

export default i18n;

// returnObjects: true,
//       maxReplaces: 1000,
//       nestingOptionsSeparator: ",",
//       prefix: "{{",
//       suffix: "}}",
//       unescapePrefix: "-",
