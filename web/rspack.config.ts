// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MultiRspackOptions } from "@rspack/core";
import path from "path";

import { ConfigParams, devServerConfig, mainConfig } from "@foxglove/studio-web/src/webpackConfigs";

import packageJson from "../package.json";

const params: ConfigParams = {
  outputPath: path.resolve(__dirname, ".webpack"),
  contextPath: path.resolve(__dirname, "src"),
  entrypoint: "./entrypoint.tsx",
  prodSourceMap: "source-map",
  version: packageJson.version,
};

// foxglove-depcheck-used: @rspack/cli
export default (
  env: Record<string, string> | undefined,
  argv: { mode?: "development" | "production" },
): MultiRspackOptions => {
  const webpackArgv = {
    mode: argv.mode ?? "development",
    env: env ?? {},
  };

  const devConfig = devServerConfig(params);
  const mainConfigResult = mainConfig(params)(env, webpackArgv);

  return [devConfig, mainConfigResult] as MultiRspackOptions;
};
