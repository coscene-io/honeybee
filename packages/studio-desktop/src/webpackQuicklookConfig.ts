// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration, type RspackPluginInstance } from "@rspack/core";
import ReactRefreshPlugin from "@rspack/plugin-react-refresh";
import path from "path";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import type { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";

import { WebpackConfigParams } from "./WebpackConfigParams";

export const webpackQuicklookConfig =
  (params: WebpackConfigParams) =>
  (_env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.WEBPACK_SERVE === "true";

    const allowUnusedVariables = isDev && isServe;

    const plugins: RspackPluginInstance[] = [
      new TsCheckerRspackPlugin({
        typescript: {
          configOverwrite: {
            compilerOptions: {
              noUnusedLocals: !allowUnusedVariables,
              noUnusedParameters: !allowUnusedVariables,
            },
          },
          memoryLimit: 4096, // 增加内存限制到 4GB
        },
      }),
      new rspack.HtmlRspackPlugin({
        templateContent: `
<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
  <script>
    global = globalThis;
  </script>
    <div id="root"></div>
  </body>
</html>
`,
      }),
      new rspack.ProvidePlugin({
        // the buffer module exposes the Buffer class as a property
        Buffer: ["buffer", "Buffer"],
      }),
    ];

    if (isServe) {
      plugins.push(new ReactRefreshPlugin());
    }

    return {
      name: "quicklook",

      context: params.quicklookContext,
      entry: params.quicklookEntrypoint,
      target: "web",
      devtool: isDev
        ? "eval-cheap-module-source-map"
        : (params.prodSourceMap as Configuration["devtool"]),

      output: {
        publicPath: isServe ? "/quicklook/" : "",
        path: path.join(params.outputPath, "quicklook"),
      },

      node: {
        __filename: true,
        __dirname: true,
      },

      module: {
        rules: [
          { test: /\.png$/, type: "asset/inline" },
          { test: /\.wasm$/, type: "asset/inline" },
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: {
              loader: "builtin:swc-loader",
              options: {
                jsc: {
                  parser: {
                    syntax: "typescript",
                    tsx: true,
                  },
                  transform: {
                    react: {
                      runtime: "automatic",
                      development: isDev,
                      refresh: isServe,
                    },
                  },
                  externalHelpers: false,
                },
                env: {
                  targets: {
                    chrome: "87",
                  },
                },
              },
            },
          },
        ],
      },

      optimization: {
        removeAvailableModules: true,
      },

      plugins,

      resolve: {
        extensions: [".js", ".ts", ".tsx", ".json"],
        fallback: {
          path: require.resolve("path-browserify"),
          stream: false,
          crypto: false,
          fs: false,
        },
      },
    };
  };
