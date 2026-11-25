// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import fs from "fs";
import path from "path";

import { segmentation as en } from "@foxglove/studio-base/i18n/en/segmentation";
import { segmentation as zh } from "@foxglove/studio-base/i18n/zh/segmentation";

// Editor copy lives in the `segmentation` namespace, not in component source.
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures and acceptance tests are not shipped UI.
      return ["testing", "acceptance"].includes(entry.name) ? [] : sourceFiles(file);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

describe("segmentation i18n", () => {
  // Every source file of the feature, including the SegmentationCanvas/, SegmentationTree/ and maskOverlay/
  // folders. Errors thrown by the store, service and adapter carry codes (errors.ts), not copy.
  const uiFiles = sourceFiles(path.join(__dirname, ".."));

  it.each(uiFiles.map((file) => [path.relative(path.join(__dirname, ".."), file), file]))(
    "%s has no hard-coded Chinese copy",
    (_name, file) => {
      const offending = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /[一-鿿]/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
      expect(offending).toEqual([]);
    },
  );

  it("translates every key into Chinese", () => {
    // Chinese has no singular plural form; `_one` keys fall back to `_other`.
    const expected = Object.keys(en).filter((key) => !key.endsWith("_one"));
    expect(expected.filter((key) => !(key in zh))).toEqual([]);
  });
});
