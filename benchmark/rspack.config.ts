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

const devServerConfig: Configuration = {
  // Use empty entry to avoid webpack default fallback to /src
  entry: {},

  // Output path must be specified here for HtmlRspackPlugin within render config to work
  output: {
    publicPath: "",
    path: path.resolve(__dirname, ".webpack"),
    clean: true,
  },

  devServer: {
    static: {
      directory: path.resolve(__dirname, ".webpack"),
    },
    hot: true,
    // The problem and solution are described at <https://github.com/webpack/webpack-dev-server/issues/1604>.
    // When running in dev mode two errors are logged to the dev console:
    //  "Invalid Host/Origin header"
    //  "[WDS] Disconnected!"
    // Since we are only connecting to localhost, DNS rebinding attacks are not a concern during dev
    allowedHosts: "all",
    headers: {
      // Enable cross-origin isolation: https://resourcepolicy.fyi
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
    },
  },

  plugins: [],
};

const mainConfig = (env: unknown, argv: WebpackArgv): Configuration => {
  const isDev = argv.mode === "development";
  const isServe = argv.env?.WEBPACK_SERVE === "true";

  const allowUnusedVariables = isDev;

  const plugins: RspackPluginInstance[] = [];

  if (isServe) {
    plugins.push(new ReactRefreshPlugin());
  }

  const appWebpackConfig = makeConfig(env, argv, {
    allowUnusedVariables,
    version: "0.0.0-benchmark",
  });

  const config: Configuration = {
    name: "main",

    ...appWebpackConfig,

    target: "web",
    context: path.resolve(__dirname, "src"),
    entry: "./index.tsx",
    devtool: isDev ? "eval-cheap-module-source-map" : "source-map",

    output: {
      publicPath: "auto",

      // Output filenames should include content hashes in order to cache bust when new versions are available
      filename: isDev ? "[name].js" : "[name].[contenthash].js",

      path: path.resolve(__dirname, ".webpack"),
      clean: true,
    },

    plugins: [
      ...plugins,
      ...(appWebpackConfig.plugins ?? []),
      new rspack.HtmlRspackPlugin({
        templateContent: `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>coScene Studio Benchmark</title>
    </head>
    <body>
      <script>
        global = globalThis;
      </script>
      <div id="root"></div>
    </body>
  </html>
  `,
      }),
    ],
  };

  return config;
};

export default (env: unknown, argv: WebpackArgv): Configuration[] => {
  // Ensure both configs share the same lifecycle args, and avoid relying on the
  // CLI to invoke nested config factories.
  const main = mainConfig(env, argv);

  return [
    {
      name: "devServer",
      ...devServerConfig,
    },
    main,
  ];
};
