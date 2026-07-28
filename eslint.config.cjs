// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const { defineConfig, globalIgnores } = require("eslint/config");
const globals = require("globals");

const base = require("./eslint/configs/base.cjs");
const jestConfig = require("./eslint/configs/jest.cjs");
const project = require("./eslint/configs/project.cjs");
const react = require("./eslint/configs/react.cjs");
const typescript = require("./eslint/configs/typescript.cjs");

module.exports = defineConfig(
  globalIgnores([
    "**/dist",
    "**/out",
    "**/template",
    "packages/**/wasm/*.js",
    "**/.webpack/**",
    "**/.yarn/**",
  ]),
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...typescript,
  ...react,
  ...jestConfig,
  ...project,
);
