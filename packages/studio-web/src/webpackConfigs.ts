// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ReactRefreshPlugin from "@pmmmwh/react-refresh-webpack-plugin";
import SentryWebpackPlugin from "@sentry/webpack-plugin";
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { Configuration, WebpackPluginInstance, DefinePlugin } from "webpack";
import type {
  ConnectHistoryApiFallbackOptions,
  Configuration as WebpackDevServerConfiguration,
} from "webpack-dev-server";

import type { WebpackArgv } from "@foxglove/studio-base/WebpackArgv";
import { makeConfig } from "@foxglove/studio-base/webpack";
import * as palette from "@foxglove/theme/src/palette";

export interface WebpackConfiguration extends Configuration {
  devServer?: WebpackDevServerConfiguration;
}

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
  indexHtmlOptions?: Partial<HtmlWebpackPlugin.Options>;
};

export const devServerConfig = (params: ConfigParams): WebpackConfiguration => ({
  // Use empty entry to avoid webpack default fallback to /src
  entry: {},

  // Output path must be specified here for HtmlWebpackPlugin within render config to work
  output: {
    publicPath: params.publicPath ?? "",
    path: params.outputPath,
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
    proxy: {
      "/v1/data": {
        target: "https://honeybee.coscene.dev",
        secure: false,
        changeOrigin: true,
      },
      "/bff": {
        target: "https://bff.coscene.dev",
        secure: false,
        changeOrigin: true,
      },
    },
    headers: {
      // Enable cross-origin isolation: https://resourcepolicy.fyi
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
    },
  },

  plugins: [new CleanWebpackPlugin()],
});

export const mainConfig =
  (params: ConfigParams) =>
  (env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.WEBPACK_SERVE ?? false;

    const allowUnusedVariables = isDev;

    const plugins: WebpackPluginInstance[] = [
      new DefinePlugin({
        "process.env.LAST_BUILD_TIME": JSON.stringify(new Date().toISOString()),
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
        new SentryWebpackPlugin({
          url: "https://sentry.coscene.site/",
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release:
            process.env.GITHUB_SHA && process.env.IMAGE_TAG === "latest"
              ? process.env.GITHUB_SHA
              : process.env.IMAGE_TAG,
          org: "coscene",
          project: "honeybee-web",
          include: path.resolve(__dirname, ".webpack"),
        }),
      );
    }

    const appWebpackConfig = makeConfig(env, argv, {
      allowUnusedVariables,
      version: params.version,
    });

    const config: Configuration = {
      name: "main",

      ...appWebpackConfig,

      target: "web",
      context: params.contextPath,
      entry: params.entrypoint,
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,

      output: {
        publicPath: "/viz/",

        // Output filenames should include content hashes in order to cache bust when new versions are available
        filename: isDev ? "[name].js" : "[name].[contenthash].js",

        path: params.outputPath,
      },

      plugins: [
        ...plugins,
        ...(appWebpackConfig.plugins ?? []),
        new CopyPlugin({
          patterns: [{ from: path.resolve(__dirname, "..", "public") }],
        }),
        new HtmlWebpackPlugin({
          templateContent: `
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="apple-mobile-web-app-capable" content="yes">
              <meta property="og:title" content="coScene"/>
              <meta property="og:description" content="Open source visualization and debugging tool for robotics"/>
              <meta property="og:type" content="website"/>
              <script src="/viz/cos-config.js?t=${
                process.env.LAST_BUILD_TIME ?? "local"
              }" type="text/javascript"></script>
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
            <script>
              global = globalThis;
            </script>
            <body>
              <div id="root"></div>
            </body>
          </html>
          `,
        }),
      ],
    };

    return config;
  };
