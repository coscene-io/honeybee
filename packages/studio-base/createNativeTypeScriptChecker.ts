// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

const nativeTypeScriptPackageJson = require.resolve("@typescript/native/package.json");

// Desktop uses a multi-compiler configuration. Keep native TypeScript checks serialized so each
// compiler does not start its own pool of workers and multiply CPU and memory usage.
TsCheckerRspackPlugin.issuesPool.size = 1;

export function createNativeTypeScriptChecker(configFile: string): TsCheckerRspackPlugin {
  return new TsCheckerRspackPlugin({
    typescript: {
      configFile,
      tsgo: true,
      typescriptPath: nativeTypeScriptPackageJson,
    },
  });
}
