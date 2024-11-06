// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ReactRefreshPlugin from "@pmmmwh/react-refresh-webpack-plugin";
import CopyPlugin from "copy-webpack-plugin";
import { ESBuildMinifyPlugin } from "esbuild-loader";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { Configuration, WebpackPluginInstance } from "webpack";

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

    const plugins: WebpackPluginInstance[] = [];

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (isServe) {
      plugins.push(new ReactRefreshPlugin());
    }

    const appWebpackConfig = makeConfig(env, argv, {
      allowUnusedVariables,
      version: params.packageJson.version,
    });

    const config: Configuration = {
      ...appWebpackConfig,

      // force web target instead of electron-render
      // Fixes "require is not defined" errors if nodeIntegration is off
      // https://gist.github.com/msafi/d1b8571aa921feaaa0f893ab24bb727b
      target: "web",
      context: params.rendererContext,
      entry: params.rendererEntrypoint,
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,

      output: {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        publicPath: isServe ? "/renderer/" : "",
        path: path.join(params.outputPath, "renderer"),
      },

      optimization: {
        removeAvailableModules: true,
        minimizer: [
          new ESBuildMinifyPlugin({
            target: "es2022",
            minify: true,
          }),
        ],
      },

      plugins: [
        ...plugins,
        ...(appWebpackConfig.plugins ?? []),
        new CopyPlugin({
          patterns: [{ from: path.resolve(__dirname, "public") }],
        }),
        new HtmlWebpackPlugin({
          templateContent: `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <script>
        // 根据协议动态设置配置文件路径
        const configPath = window.location.protocol === 'file:'
          ? './cos-config.js'
          : '/cos-config.js';
        const script = document.createElement('script');
        script.src = configPath + '?t=${process.env.LAST_BUILD_TIME ?? "local"}';
        script.type = 'text/javascript';
        document.head.appendChild(script);
      </script>
    </head>
    <script>
      global = globalThis;
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
