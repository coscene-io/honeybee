// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import fs from "fs";
import path from "path";

import { segmentation as en } from "@foxglove/studio-base/i18n/en/segmentation";
import { segmentation as zh } from "@foxglove/studio-base/i18n/zh/segmentation";

// U7: editor copy lives in the `segmentation` namespace, not in component source.
describe("segmentation i18n", () => {
  const uiFiles = [
    ...fs
      .readdirSync(__dirname)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => path.join(__dirname, name)),
    path.join(__dirname, "..", "SemanticSegmentationWorkbench.tsx"),
    path.join(__dirname, "..", "cameraFrames.ts"),
    path.join(__dirname, "..", "segmentationChrome.ts"),
    // Errors thrown by the store, service and adapter carry codes (errors.ts), not copy.
    ...[
      "frameTime.ts",
      "liveService.ts",
      "polygonContract.ts",
      "propagationRunner.ts",
      "quickSegment.ts",
      "runtime.ts",
      "service.ts",
      "sourceFrames.ts",
      "store.ts",
      "submissionQueue.ts",
    ].map((name) => path.join(__dirname, "..", name)),
  ];

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
