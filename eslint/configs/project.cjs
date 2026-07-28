// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const prettierPlugin = require("eslint-plugin-prettier");
const tssUnusedClasses = require("eslint-plugin-tss-unused-classes");

module.exports = [
  {
    plugins: {
      prettier: prettierPlugin,
      "tss-unused-classes": tssUnusedClasses,
    },
    settings: {
      "import/internal-regex": "^@foxglove",
    },
    rules: {
      "@coscene-io/license-header": "error",
      "@coscene-io/link-target": "error",
      "@coscene-io/lodash-ramda-imports": "error",
      "id-denylist": ["error", "useEffectOnce", "window"],
      "import/no-duplicates": "error",
      "import/no-self-import": "error",
      "no-console": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MethodDefinition[kind='get'], Property[kind='get']",
          message: "Property getters are not allowed; prefer function syntax instead.",
        },
        {
          selector: "MethodDefinition[kind='set'], Property[kind='set']",
          message: "Property setters are not allowed; prefer function syntax instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name!=/^(warn|error|debug|assert)$/]",
          message: "Unexpected property on console object was called",
        },
        {
          selector: "TSNullKeyword, Literal[raw=null]",
          message:
            "Prefer undefined instead of null. When required for React refs/components, use the `ReactNull` alias.",
        },
        {
          selector: "CallExpression[callee.name='setTimeout'][arguments.length<2]",
          message: "`setTimeout()` must be invoked with at least two arguments.",
        },
        {
          selector: "CallExpression[callee.name='setInterval'][arguments.length<2]",
          message: "`setInterval()` must be invoked with at least two arguments.",
        },
        {
          selector: "CallExpression[callee.object.name='Promise'][callee.property.name='race']",
          message: "Promise.race is banned; use `race-as-promised` instead.",
        },
      ],
      "prettier/prettier": "off",
      "tss-unused-classes/unused-classes": "error",
    },
  },
  {
    files: ["packages/studio-desktop/src/main/**/*.{js,ts}"],
    rules: {
      "import/default": "off",
      "import/namespace": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-unresolved": "off",
    },
  },
];
