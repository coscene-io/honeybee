// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { UserScriptUtility } from "@foxglove/studio";
import type { UserScript } from "@foxglove/studio-base/types/panels";

import markers from "./userUtils/markers.ts?raw";
import pointClouds from "./userUtils/pointClouds.ts?raw";
import quaternions from "./userUtils/quaternions.ts?raw";
import readers from "./userUtils/readers.ts?raw";
import time from "./userUtils/time.ts?raw";
import types from "./userUtils/types.ts?raw";
import vectors from "./userUtils/vectors.ts?raw";

const builtinUtilities = [
  { fileName: "pointClouds.ts", sourceCode: pointClouds },
  { fileName: "quaternions.ts", sourceCode: quaternions },
  { fileName: "readers.ts", sourceCode: readers },
  { fileName: "time.ts", sourceCode: time },
  { fileName: "types.ts", sourceCode: types },
  { fileName: "vectors.ts", sourceCode: vectors },
  { fileName: "markers.ts", sourceCode: markers },
];

export const reservedUtilityNames = new Set([
  ...builtinUtilities.map(({ fileName }) => fileName.toLowerCase()),
  "generatedtypes.ts",
  "index.ts",
]);

export function getUtilityFiles(
  extensions: readonly UserScriptUtility[] = [],
  convention?: UserScript["rotationConvention"],
): { fileName: string; sourceCode: string }[] {
  const rotate = convention === "standard" ? "rotateVector" : "rotateLegacy";
  return [
    ...builtinUtilities.map((file) =>
      file.fileName === "vectors.ts"
        ? { ...file, sourceCode: file.sourceCode + `\nexport { ${rotate} as rotate };\n` }
        : file,
    ),
    ...extensions.map(({ name, source }) => ({ fileName: name, sourceCode: source })),
  ];
}
