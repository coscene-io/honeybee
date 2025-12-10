// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration } from "@rspack/core";
import path from "path";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";

import { WebpackConfigParams } from "./WebpackConfigParams";

export const webpackPreloadConfig =
  (params: WebpackConfigParams) =>
  (_: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";

    return {
      context: params.preloadContext,
      entry: params.preloadEntrypoint,
      target: "electron-preload",
      devtool: isDev
        ? "eval-cheap-module-source-map"
        : (params.prodSourceMap as Configuration["devtool"]),

      output: {
        publicPath: "",
        filename: "preload.js",
        // Put the preload script in main since main becomes the "app path"
        // This simplifies setting the 'preload' webPrefereces option on BrowserWindow
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
        new rspack.DefinePlugin({
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

      resolve: {
        extensions: [".js", ".ts", ".tsx", ".json"],
      },
    };
  };
