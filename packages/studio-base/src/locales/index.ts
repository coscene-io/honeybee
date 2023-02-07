// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { enPreferences } from "./en";
import { enDataSource } from "./en";
import { enLayouts } from "./en";
import { enAddPanel } from "./en";
import { enPanelSetting } from "./en";
import { enStudioLogsSettings } from "./en";
import { enAccount } from "./en";
import { enCommon } from "./en";
import { enDiagnostic } from "./en";
import { enPublish } from "./en";
import { enUserScript } from "./en";
import { zhPreferences } from "./zh";
import { zhDataSource } from "./zh";
import { zhLayouts } from "./zh";
import { zhAddPanel } from "./zh";
import { zhPanelSetting } from "./zh";
import { zhStudioLogsSettings } from "./zh";
import { zhAccount } from "./zh";
import { zhCommon } from "./zh";
import { zhDiagnostic } from "./zh";
import { zhPublish } from "./zh";
import { zhUserScript } from "./zh";

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
  },
};
