// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { readFileSync } from "node:fs";
import { join } from "node:path";

const INACTIVE_TOOLBAR_ICON_COLOR = "#a7a6af";
const ACTIVE_TOOLBAR_ICON_COLOR = "#2563EB";
const INACTIVE_TOOLBAR_ICON_ASSETS = [
  "event-create-inactive.svg",
  "moment-subtitle-inactive.svg",
  "rolling-edit-inactive.svg",
] as const;
const ACTIVE_TOOLBAR_ICON_ASSETS = ["rolling-edit-active.svg"] as const;

function readToolbarIconAsset(fileName: string): string {
  return readFileSync(join(__dirname, "../../assets", fileName), "utf8");
}

describe("scrubber toolbar icon assets", () => {
  it.each(INACTIVE_TOOLBAR_ICON_ASSETS)(
    "uses the zoom icon inactive color directly in %s",
    (fileName) => {
      const svg = readToolbarIconAsset(fileName);

      expect(svg).toContain(INACTIVE_TOOLBAR_ICON_COLOR);
      expect(svg).not.toContain('opacity="0.45"');
      expect(svg).not.toContain('stroke-opacity="0.45"');
    },
  );

  it.each(ACTIVE_TOOLBAR_ICON_ASSETS)(
    "uses the active toolbar color directly in %s",
    (fileName) => {
      const svg = readToolbarIconAsset(fileName);

      expect(svg).toContain(ACTIVE_TOOLBAR_ICON_COLOR);
      expect(svg).not.toContain('opacity="0.45"');
      expect(svg).not.toContain('stroke-opacity="0.45"');
    },
  );
});
