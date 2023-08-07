// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

<<<<<<<< HEAD:packages/studio-base/src/i18n/cosEn/settings.ts
export const cosSettings = {
  high: "High",
  mid: "Medium",
  low: "Low",
  original: "Original",
  quality: "Quality",
  willTakeEffectOnTheNextStartup: "Will take effect on the next startup",
========
import { PanelConfig } from "@foxglove/studio-base/types/panels";

export type PanelSelection = {
  type: string;
  config?: PanelConfig;
  relatedConfigs?: { [panelId: string]: PanelConfig };
>>>>>>>> foxglove/release/v1.64.0:packages/studio-base/src/components/PanelCatalog/types.ts
};
