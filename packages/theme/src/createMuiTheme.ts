// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as locales from "@mui/material/locale";
import { createTheme, Theme } from "@mui/material/styles";

import * as components from "./components";
import * as palette from "./palette";
import { typography } from "./typography";

type ThemePreference = "dark" | "light";

declare module "@mui/material/styles" {
  interface Theme {
    name?: ThemePreference;
  }
  interface ThemeOptions {
    name?: ThemePreference;
  }
}

export function i18nextLanguageToMuiImportName(lang: string): locales.Localization {
  switch (lang) {
    case "zh":
      return locales["zhCN"];
    case "jp":
      return locales["jaJP"];
    case "en":
      return locales["enUS"];
    default:
      return locales["enUS"];
  }
}

export const createMuiTheme = (themePreference: ThemePreference, lang: string): Theme =>
  createTheme(
    {
      name: themePreference,
      palette: palette[themePreference],
      shape: { borderRadius: 2 },
      typography,
      components,
    },
    i18nextLanguageToMuiImportName(lang),
  );
