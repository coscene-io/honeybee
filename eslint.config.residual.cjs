// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Oxlint handles every rule represented in .oxlintrc.json. Keep ESLint only for rules that Oxlint
// cannot yet reproduce without changing diagnostics, including the local type-aware rules.
const oxlintPlugin = require("eslint-plugin-oxlint");
const path = require("node:path");

const baseConfig = require("./eslint.config.ci.cjs");

module.exports = [
  ...baseConfig,
  ...oxlintPlugin.buildFromOxlintConfigFile(path.join(__dirname, ".oxlintrc.json")),
  {
    linterOptions: {
      // Oxlint consumes the existing eslint-disable comments for the migrated rules. ESLint cannot
      // distinguish those from stale directives after the corresponding rules are disabled here.
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      // Formatting is checked once, directly through Prettier, instead of once per ESLint file.
      "prettier/prettier": "off",
    },
  },
];
