// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration, type ResolveOptions } from "@rspack/core";
import path from "path";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";

import { WebpackConfigParams } from "./WebpackConfigParams";

export const webpackMainConfig =
  (params: WebpackConfigParams) =>
  (_: unknown, argv: WebpackArgv): Configuration => {
    const isServe = argv.env?.WEBPACK_SERVE ?? false;

    const isDev = argv.mode === "development";

    const resolve: ResolveOptions = {
      extensions: [".js", ".ts", ".tsx", ".json"],
    };

    if (!isDev) {
      // Stub out devtools installation for non-dev builds
      resolve.alias = {
        "electron-devtools-installer": false,
      };
    }

    // When running under a development server the renderer entry comes from the server.
    // When making static builds (for packaging), the renderer entry is a file on disk.
    // This switches between the two and is injected below via DefinePlugin as MAIN_WINDOW_WEBPACK_ENTRY
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const rendererEntry = isServe
      ? `"http://${argv.host ?? "localhost"}:8080/renderer/index.html"`
      : "`file://${require('path').join(__dirname, '..', 'renderer', 'index.html')}`";

    return {
      context: params.mainContext,
      entry: params.mainEntrypoint,
      target: "electron-main",
      devtool: isDev
        ? "eval-cheap-module-source-map"
        : (params.prodSourceMap as Configuration["devtool"]),

      output: {
        publicPath: "",
        path: path.join(params.outputPath, "main"),
      },

      module: {
        rules: [
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
                    },
                  },
                  externalHelpers: false,
                },
                env: {
                  targets: {
                    node: "20",
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

      plugins: [
        new rspack.ProvidePlugin({
          React: "react",
        }),
        new rspack.DefinePlugin({
          MAIN_WINDOW_WEBPACK_ENTRY: rendererEntry,
          COSCENE_PRODUCT_NAME: JSON.stringify(params.packageJson.productName),
          COSCENE_PRODUCT_VERSION: JSON.stringify(params.packageJson.version),
          COSCENE_PRODUCT_HOMEPAGE: JSON.stringify(params.packageJson.homepage),
        }),
        new TsCheckerRspackPlugin({
          typescript: {
            memoryLimit: 4096, // 增加内存限制到 4GB
          },
        }),
      ],

      resolve,
    };
  };
