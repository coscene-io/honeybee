// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const coscenePlugin = require("@coscene-io/eslint-plugin");
const js = require("@eslint/js");
const eslintConfigPrettier = require("eslint-config-prettier/flat");
const importPlugin = require("eslint-plugin-import");

module.exports = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      "@coscene-io": coscenePlugin,
      import: importPlugin,
    },
    rules: {
      "@coscene-io/filename-match-exported": "error",
      "@coscene-io/no-regexp-lookbehind-assertions": "error",
      "@coscene-io/no-return-promise-resolve": "error",
      "@coscene-io/prefer-hash-private": "error",
      "@coscene-io/strict-equality": "error",

      "import/export": "error",
      "import/first": "error",
      "import/named": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "import/no-mutable-exports": "error",
      "import/no-useless-path-segments": "error",
      "import/order": [
        "error",
        {
          alphabetize: { order: "asc" },
          "newlines-between": "always",
          groups: [["builtin", "external"], ["internal"], ["parent", "sibling", "index"]],
        },
      ],

      curly: "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-param-reassign": "error",
      "no-unassigned-vars": "error",
      "no-unused-expressions": ["error", { enforceForJSX: true }],
      "no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
      "no-underscore-dangle": ["error", { allowAfterThis: true }],
      "no-useless-rename": "error",
      "no-warning-comments": ["error", { location: "anywhere" }],
      "object-shorthand": "error",
      "prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
    },
  },
];
