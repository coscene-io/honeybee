// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { rspack, type Configuration, type RspackPluginInstance } from "@rspack/core";
import ReactRefreshPlugin from "@rspack/plugin-react-refresh";
import { sentryWebpackPlugin } from "@sentry/webpack-plugin";
import path from "path";
import type { ConnectHistoryApiFallbackOptions } from "webpack-dev-server";

import type { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";
import { makeConfig } from "@foxglove/studio-base/webpack";
import * as palette from "@foxglove/theme/src/palette";

export interface RspackConfiguration extends Configuration {
  devServer?: {
    static?: {
      directory?: string;
    };
    historyApiFallback?: ConnectHistoryApiFallbackOptions;
    hot?: boolean;
    allowedHosts?: string | string[];
    proxy?: Array<{
      context: string[];
      target: string;
      secure?: boolean;
      changeOrigin?: boolean;
    }>;
    headers?: Record<string, string>;
    client?: {
      overlay?: {
        runtimeErrors?: (error: Error) => boolean;
      };
    };
  };
}

// Keep the old export name for compatibility
export type WebpackConfiguration = RspackConfiguration;

export type ConfigParams = {
  /** Directory to find `entrypoint` and `tsconfig.json`. */
  contextPath: string;
  entrypoint: string;
  outputPath: string;
  publicPath?: string;
  /** Source map (`devtool`) setting to use for production builds */
  prodSourceMap: string | false;
  /** Set the app version information */
  version: string;
  /** Needs to be overridden for react-router */
  historyApiFallback?: ConnectHistoryApiFallbackOptions;
  /** Customizations to index.html */
  indexHtmlOptions?: Partial<{
    title?: string;
    filename?: string;
    template?: string;
    templateContent?: string;
    inject?: boolean | "head" | "body";
    publicPath?: string;
    scriptLoading?: "blocking" | "defer" | "module";
    chunks?: string[];
    excludeChunks?: string[];
    meta?: Record<string, string | Record<string, string>>;
  }>;
};

export const devServerConfig = (params: ConfigParams): RspackConfiguration => ({
  // Use empty entry to avoid rspack default fallback to /src
  entry: {},

  // Output path must be specified here for HtmlRspackPlugin within render config to work
  output: {
    publicPath: params.publicPath ?? "",
    path: params.outputPath,
    clean: true,
  },

  devServer: {
    static: {
      directory: params.outputPath,
    },
    historyApiFallback: params.historyApiFallback,
    hot: true,
    // The problem and solution are described at <https://github.com/webpack/webpack-dev-server/issues/1604>.
    // When running in dev mode two errors are logged to the dev console:
    //  "Invalid Host/Origin header"
    //  "[WDS] Disconnected!"
    // Since we are only connecting to localhost, DNS rebinding attacks are not a concern during dev
    allowedHosts: "all",
    proxy: [
      {
        context: ["/v1/data"],
        target: "https://viz.dev.coscene.cn",
        secure: false,
        changeOrigin: true,
      },
      {
        context: ["/bff"],
        target: "https://bff.dev.coscene.cn",
        secure: false,
        changeOrigin: true,
      },
    ],
    headers: {
      // Enable cross-origin isolation: https://resourcepolicy.fyi
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
    },

    client: {
      overlay: {
        runtimeErrors: (error) => {
          // Suppress overlays for importScript errors from terminated webworkers.
          //
          // When a webworker is terminated, any pending `importScript` calls are cancelled by the
          // browser. These appear in the devtools network tab as "(cancelled)" and bubble up to the
          // parent page as errors which trigger `window.onerror`.
          //
          // rspack devserver attaches to the window error handler surface unhandled errors sent to
          // the page. However this kind of error is a false-positive for a worker that is
          // terminated because we do not care that its network requests were cancelled since the
          // worker itself is gone.
          //
          // Will this hide real importScript errors during development?
          // It is possible that a worker encounters this error during normal operation (if
          // importing a script does fail for a legitimate reason). In that case we expect the
          // worker logic that depended on the script to fail execution and trigger other kinds of
          // errors. The developer can still see the importScripts error in devtools console.
          if (
            error.message.startsWith(
              `Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'`,
            )
          ) {
            return false;
          }

          return true;
        },
      },
    },
  },

  resolve: {
    fallback: {
      assert: require.resolve("assert/"),
    },
  },

  plugins: [],
});

export const mainConfig =
  (params: ConfigParams) =>
  (env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.WEBPACK_SERVE === "true";

    const allowUnusedVariables = isDev;

    // 在rspack配置阶段生成构建时间，确保HTML模板和DefinePlugin使用相同的值
    const buildTime = new Date().toISOString();

    const plugins: RspackPluginInstance[] = [
      new rspack.DefinePlugin({
        "process.env.LAST_BUILD_TIME": JSON.stringify(buildTime),
        "process.env.IMAGE_TAG": JSON.stringify(process.env.IMAGE_TAG),
        "process.env.GITHUB_SHA": JSON.stringify(process.env.GITHUB_SHA),
      }),
    ];

    if (isServe) {
      plugins.push(new ReactRefreshPlugin());
    }

    // Source map upload if configuration permits
    if (!isDev) {
      plugins.push(
        sentryWebpackPlugin({
          url: "https://sentry.coscene.site/",
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: {
            name:
              process.env.GITHUB_SHA && process.env.IMAGE_TAG === "latest"
                ? process.env.GITHUB_SHA
                : process.env.IMAGE_TAG,
          },
          org: "coscene",
          project: "honeybee-web",
          sourcemaps: {
            assets: path.resolve(__dirname, ".webpack"),
          },
          errorHandler: (err) => {
            console.warn(err);
          },
        }) as RspackPluginInstance,
      );
    }

    const appRspackConfig = makeConfig(env, argv, {
      allowUnusedVariables,
      version: params.version,
    });

    const config: Configuration = {
      name: "main",

      ...appRspackConfig,

      target: "web",
      context: params.contextPath,
      entry: params.entrypoint,
      devtool: isDev
        ? "eval-cheap-module-source-map"
        : (params.prodSourceMap as Configuration["devtool"]),

      output: {
        publicPath: isServe ? "auto" : "/viz/",

        // Output filenames should include content hashes in order to cache bust when new versions are available
        filename: isDev ? "[name].js" : "[name].[contenthash].js",

        path: params.outputPath,
        clean: true,
      },

      plugins: [
        ...plugins,
        ...(appRspackConfig.plugins ?? []),
        new rspack.CopyRspackPlugin({
          patterns: [{ from: path.resolve(__dirname, "..", "public") }],
        }),
        new rspack.HtmlRspackPlugin({
          templateContent: `
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="apple-mobile-web-app-capable" content="yes">
              <meta property="og:title" content="coScene"/>
              <meta property="og:description" content="visualization and debugging tool for robotics"/>
              <meta property="og:type" content="website"/>
              <script src="${
                isServe ? "/" : "/viz/"
              }cos-config.js?t=${buildTime}" type="text/javascript"></script>
              <title>coScene</title>
              <style type="text/css" id="loading-styles">
                body {
                  margin: 0;
                }
                #root {
                  height: 100vh;
                  background-color: ${palette.light.background?.default};
                  color: ${palette.light.text?.primary};
                }
                @media (prefers-color-scheme: dark) {
                  #root {
                    background-color: ${palette.dark.background?.default}};
                    color: ${palette.dark.text?.primary};
                  }
                }
              </style>
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
