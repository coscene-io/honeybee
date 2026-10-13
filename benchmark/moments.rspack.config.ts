// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration } from "@rspack/core";
import path from "path";

import type { WebpackArgv } from "../packages/studio-base/WebpackArgv";
import { makeConfig } from "../packages/studio-base/webpack";

/** Isolated production harness: real moment components, deterministic data, no network/player decoding. */
export default (env: unknown, argv: WebpackArgv): Configuration => {
  const base = makeConfig(env, argv, {
    tsconfigPath: path.resolve(__dirname, "src/tsconfig.json"),
    version: "moment-benchmark",
  });
  return {
    ...base,
    mode: "production",
    target: "web",
    context: __dirname,
    entry: "./src/MomentsBenchmark.tsx",
    devtool: "source-map",
    output: { path: path.resolve(__dirname, ".webpack-moments"), clean: true },
    plugins: [
      ...(base.plugins ?? []),
      new rspack.HtmlRspackPlugin({
        templateContent:
          '<html><body style="margin:0"><script>global=globalThis</script><div id="root"></div></body></html>',
      }),
    ],
  };
};
