// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const importPlugin = require("eslint-plugin-import");
const tseslint = require("typescript-eslint");

const files = ["**/*.{ts,tsx}"];
const scope = (config) => ({ ...config, files });

module.exports = [
  ...tseslint.configs.strictTypeChecked.map(scope),
  ...tseslint.configs.stylisticTypeChecked.map(scope),
  scope({
    plugins: {
      import: importPlugin,
    },
  }),
  scope(importPlugin.configs.typescript),
  scope({
    languageOptions: {
      parserOptions: {
        project: "tsconfig.eslint.json",
        tsconfigRootDir: __dirname + "/../..",
      },
    },
    rules: {
      "@coscene-io/no-boolean-parameters": "error",
      "@coscene-io/no-map-type-argument": "error",
      "@coscene-io/ramda-usage": "error",

      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
        },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
        },
      ],
      "@typescript-eslint/explicit-member-accessibility": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-confusing-non-null-assertion": "error",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-meaningless-void-operator": ["error", { checkNever: true }],
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-shadow": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      // Generated protocol enums and numeric rendering enums are intentionally compared across
      // compatible domains throughout the codebase.
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { enforceForJSX: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          varsIgnorePattern: "^_.",
          argsIgnorePattern: "^_.",
        },
      ],
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        {
          ignoreConditionalTests: true,
        },
      ],
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/return-await": ["error", "always"],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: true,
          allowNullableString: true,
          allowNumber: false,
          allowNullableNumber: false,
          allowNullableBoolean: false,
          allowNullableObject: true,
          allowAny: false,
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      "@typescript-eslint/unbound-method": ["error", { ignoreStatic: true }],

      "no-loop-func": "error",
      "no-unused-expressions": "off",
      "no-unused-vars": "off",
      "no-warning-comments": "off",
    },
  }),
  scope({
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/dot-notation": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/unified-signatures": "off",
    },
  }),
];
