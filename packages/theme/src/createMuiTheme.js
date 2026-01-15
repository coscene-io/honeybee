// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { zhCN, jaJP, enUS } from "@mui/material/locale";
import { createTheme } from "@mui/material/styles";
import * as _ from "lodash-es";
import * as components from "./components";
import * as palette from "./palette";
import { typography } from "./typography";
function getMaterialLocale(lang) {
    switch (lang) {
        case "zh":
            return zhCN;
        case "jp":
            return jaJP;
        case "en":
            return enUS;
        default:
            return enUS;
    }
}
export const createMuiTheme = (themePreference, lang) => createTheme(_.merge(getMaterialLocale(lang), {
    name: themePreference,
    palette: palette[themePreference],
    shape: { borderRadius: 2 },
    typography,
    components,
}));
