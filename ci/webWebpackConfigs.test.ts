// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

jest.mock("@rspack/core", () => ({
  rspack: {
    CopyRspackPlugin: class CopyRspackPlugin {},
    DefinePlugin: class DefinePlugin {},
    HtmlRspackPlugin: class HtmlRspackPlugin {},
  },
}));
jest.mock("@rspack/plugin-react-refresh", () => ({
  ReactRefreshRspackPlugin: class ReactRefreshRspackPlugin {},
}));
jest.mock("@sentry/webpack-plugin", () => ({
  sentryWebpackPlugin: jest.fn(() => ({})),
}));
jest.mock("@foxglove/studio-base/WebpackArgv", () => ({
  isRspackServe: (argv: { env?: { RSPACK_SERVE?: string; WEBPACK_SERVE?: string } }) =>
    argv.env?.RSPACK_SERVE === "true" || argv.env?.WEBPACK_SERVE === "true",
}));
jest.mock("@foxglove/studio-base/webpack", () => ({
  makeConfig: () => ({ plugins: [] }),
}));
jest.mock("@foxglove/theme/src/palette", () => ({
  dark: { background: { default: "#15151a" }, text: { primary: "#e1e1e4" } },
  light: { background: { default: "#f4f4f5" }, text: { primary: "#393939" } },
}));

const { devServerConfig, mainConfig } = jest.requireActual(
  "../packages/studio-web/src/webpackConfigs",
) as typeof import("../packages/studio-web/src/webpackConfigs");

const params = {
  contextPath: path.resolve(__dirname, "../web/src"),
  entrypoint: "./entrypoint.tsx",
  outputPath: path.resolve(__dirname, "../web/.webpack"),
  prodSourceMap: "source-map",
  version: "TEST",
};

describe("web webpack configs", () => {
  it("does not serve stale disk build files from the dev server", () => {
    expect(devServerConfig(params).devServer?.static).toBe(false);
  });

  it("disables lazy compilation for deterministic dev chunk loading", () => {
    const config = mainConfig(params)(undefined, {
      mode: "development",
      env: { RSPACK_SERVE: "true" },
    });

    expect(config.lazyCompilation).toBe(false);
  });
});
