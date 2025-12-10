// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration, type RspackPluginInstance } from "@rspack/core";
import ReactRefreshPlugin from "@rspack/plugin-react-refresh";
import path from "path";

import type { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";
import { makeConfig } from "@foxglove/studio-base/webpack";
import * as palette from "@foxglove/theme/src/palette";

import { WebpackConfigParams } from "./WebpackConfigParams";

export const webpackRendererConfig =
  (params: WebpackConfigParams) =>
  (env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.WEBPACK_SERVE ?? false;

    const allowUnusedVariables = isDev;

    // 在rspack配置阶段生成构建时间，确保HTML模板和DefinePlugin使用相同的值
    const buildTime = new Date().toISOString();

    const plugins: RspackPluginInstance[] = [];

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (isServe) {
      plugins.push(new ReactRefreshPlugin());
    }

    const appRspackConfig = makeConfig(env, argv, {
      allowUnusedVariables,
      version: params.packageJson.version,
    });

    const config: Configuration = {
      ...appRspackConfig,

      // force web target instead of electron-render
      // Fixes "require is not defined" errors if nodeIntegration is off
      // https://gist.github.com/msafi/d1b8571aa921feaaa0f893ab24bb727b
      target: "web",
      context: params.rendererContext,
      entry: params.rendererEntrypoint,
      devtool: isDev
        ? "eval-cheap-module-source-map"
        : (params.prodSourceMap as Configuration["devtool"]),

      output: {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        publicPath: isServe ? "/renderer/" : "",
        path: path.join(params.outputPath, "renderer"),
        clean: true,
      },

      optimization: {
        removeAvailableModules: true,
      },

      plugins: [
        ...plugins,
        ...(appRspackConfig.plugins ?? []),
        new rspack.CopyRspackPlugin({
          patterns: [{ from: path.resolve(__dirname, "public") }],
        }),
        new rspack.HtmlRspackPlugin({
          templateContent: `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
  </head>
  <body>
  <script>
    global = globalThis;
    window.cosConfig = window.cosConfig || {};
    window.buildTime = "${buildTime}";
  </script>
  <style>
    html, body {
      background-color: ${palette.light.background?.default};
      color: ${palette.light.text?.primary};
    }
    @media (prefers-color-scheme: dark) {
      html, body {
        background-color: ${palette.dark.background?.default};
        color: ${palette.dark.text?.primary};
      }
    }
  </style>
    <div id="root"></div>
  </body>
</html>
`,
        }),
      ],
    };

    return config;
  };
