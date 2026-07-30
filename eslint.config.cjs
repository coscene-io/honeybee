// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const coscenePlugin = require("@coscene-io/eslint-plugin");
const { globalIgnores } = require("eslint/config");
const importPlugin = require("eslint-plugin-import");
const jestPlugin = require("eslint-plugin-jest");
const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");
const tssUnusedClassesPlugin = require("eslint-plugin-tss-unused-classes");
const globals = require("globals");
const path = require("node:path");
const tseslint = require("typescript-eslint");

// Oxlint owns the primary rule set. This file is the explicit fallback for rules that require
// local plugins or do not yet have behavior-compatible Oxlint implementations.
const rootDir = __dirname;
const typescriptFiles = ["**/*.{ts,tsx}"];

const importOrderRule = [
  "error",
  {
    alphabetize: { order: "asc" },
    "newlines-between": "always",
    groups: [["builtin", "external"], ["internal"], ["parent", "sibling", "index"]],
  },
];

const restrictedSyntaxRule = [
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
];

module.exports = [
  globalIgnores([
    "**/dist",
    "**/out",
    "**/template",
    "packages/**/wasm/*.js",
    "**/.webpack/**",
    "**/.yarn/**",
  ]),
  {
    linterOptions: {
      // Oxlint consumes the existing eslint-disable comments for migrated rules. ESLint cannot
      // distinguish those from stale directives after the corresponding rules move to Oxlint.
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@coscene-io": coscenePlugin,
      import: importPlugin,
      "tss-unused-classes": tssUnusedClassesPlugin,
    },
    settings: {
      "import/internal-regex": "^@foxglove",
    },
    rules: {
      // Core rules that Oxlint does not implement or whose diagnostics differ from ESLint.
      "no-dupe-args": "error",
      "no-implied-eval": "error",
      "no-octal": "error",
      "no-undef": "error",
      "no-unsafe-optional-chaining": "error",
      "no-restricted-syntax": restrictedSyntaxRule,

      // Project rules are implemented by the local plugin.
      "@coscene-io/filename-match-exported": "error",
      "@coscene-io/license-header": "error",
      "@coscene-io/link-target": "error",
      "@coscene-io/lodash-ramda-imports": "error",
      "@coscene-io/no-regexp-lookbehind-assertions": "error",
      "@coscene-io/no-return-promise-resolve": "error",
      "@coscene-io/prefer-hash-private": "error",
      "@coscene-io/strict-equality": "error",

      // Oxlint does not yet cover these import-plugin checks with equivalent behavior.
      "import/export": "error",
      "import/named": "error",
      "import/no-useless-path-segments": "error",
      "import/order": importOrderRule,

      "tss-unused-classes/unused-classes": "error",
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "tsconfig.eslint.json",
        tsconfigRootDir: rootDir,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    settings: {
      "import/extensions": [".ts", ".cts", ".mts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      "import/external-module-folders": ["node_modules", "node_modules/@types"],
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".cts", ".mts", ".tsx"],
      },
      "import/resolver": {
        node: {
          extensions: [".ts", ".cts", ".mts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
        },
        typescript: {
          project: path.join(rootDir, "tsconfig.eslint.json"),
        },
      },
    },
    rules: {
      // The TypeScript parser replaces these core checks.
      "no-dupe-args": "off",
      "no-implied-eval": "off",
      "no-undef": "off",
      "import/named": "off",

      // Project-specific type-aware rules.
      "@coscene-io/no-boolean-parameters": "error",
      "@coscene-io/no-map-type-argument": "error",
      "@coscene-io/ramda-usage": "error",

      // Type-aware rules retained because Oxlint currently reports different diagnostics.
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        {
          ignoreConditionalTests: true,
        },
      ],
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/jsx-curly-brace-presence": ["error", "never"],
      "react/jsx-uses-vars": "error",
      "react/no-deprecated": "error",
      "react/no-unused-prop-types": "error",
      "react/require-render-return": "error",
      "react-hooks/exhaustive-deps": [
        "error",
        {
          additionalHooks: "(useAsync(?!AppConfigurationValue))|useCallbackWithToast",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: globals.jest,
    },
    plugins: {
      jest: jestPlugin,
    },
    rules: {
      "jest/no-standalone-expect": "error",
    },
  },
];
