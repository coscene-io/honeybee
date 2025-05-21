// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const tssUnusedClasses = require("eslint-plugin-tss-unused-classes");
const globals = require("globals");
const tslintPlugin = require("typescript-eslint");

const foxgloveEslintPlugin = require("@foxglove/eslint-plugin");
const foxgloveEslintPluginStudio = require("@foxglove/eslint-plugin-studio");

module.exports = tslintPlugin.config(
  {
    ignores: [
      "**/dist",
      "**/out",
      "**/template",
      "packages/**/wasm/*.js",
      "!**/.storybook",
      "**/storybook-static",
      "**/.webpack/**",
      "**/.yarn/**",
    ],
  },
  ...foxgloveEslintPlugin.configs.base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: "tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
  },

  ...foxgloveEslintPlugin.configs.typescript.map((config) => ({
    ...config,
    files: ["**/*.@(ts|tsx)"],
  })),

  ...foxgloveEslintPlugin.configs.react.map((config) => ({
    ...config,
    files: ["**/*.@(jsx|tsx)"],
    rules: {
      ...config.rules,
      "react/jsx-uses-react": "off",
      "react/jsx-curly-brace-presence": ["error", "never"],
      "react/forbid-component-props": [
        "error",
        {
          forbid: [
            {
              propName: "sx",
              message:
                "Use of the sx prop is not advised due to performance issues. Consider using alternative styling methods instead.",
            },
          ],
        },
      ],

      "react-hooks/exhaustive-deps": [
        "error",
        {
          additionalHooks: "(useAsync(?!AppConfigurationValue))|useCallbackWithToast",
        },
      ],
    },
  })),

  ...foxgloveEslintPlugin.configs.jest.map((config) => ({
    ...config,
    files: ["**/*.test.@(js|jsx|ts|tsx)"],
    rules: {
      "jest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect*", "sendNotification.expectCalledDuringTest"],
        },
      ],
    },
  })),

  {
    plugins: {
      "tss-unused-classes": tssUnusedClasses,
      "@foxglove/studio": foxgloveEslintPluginStudio,
    },

    settings: {
      "import/internal-regex": "^@foxglove",
    },

    rules: {
      "tss-unused-classes/unused-classes": "error",
      "prettier/prettier": "off",
      "import/no-self-import": "error",
      "import/no-duplicates": "error",
      "id-denylist": ["error", "useEffectOnce", "window"],
      "no-console": "off",
      "@foxglove/studio/license-header": "error",

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
            'Prefer undefined instead of null. When required for React refs/components, use the `ReactNull` alias. Otherwise, if strictly necessary, disable this error with `// eslint-disable-next-line no-restricted-syntax`. For rationale, see: https://github.com/sindresorhus/meta/discussions/7"\n',
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
          message:
            'Promise.race is banned\n  use `import { race } from "@foxglove/den/async"` instead\n\nSee:\n  https://github.com/nodejs/node/issues/17469#issuecomment-685216777\n  https://bugs.chromium.org/p/v8/issues/detail?id=9858"\n',
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],

    languageOptions: {
      parserOptions: {
        project: "tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },

    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
        },
      ],

      "@typescript-eslint/explicit-member-accessibility": "error",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/no-unnecessary-condition": "error",

      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",

      "@typescript-eslint/unbound-method": [
        "error",
        {
          ignoreStatic: true,
        },
      ],

      "no-loop-func": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          varsIgnorePattern: "^_.",
          argsIgnorePattern: "^_.",
        },
      ],
      "no-warning-comments": "off",
    },
  },
  {
    files: ["**/*.stories.tsx", "**/*.test.tsx", "**/*.test.ts"],

    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.stories.tsx"],

    rules: {
      "react/forbid-component-props": "off",
    },
  },
  {
    files: [
      "./packages/studio-desktop/src/main/**/*.ts",
      "./packages/studio-desktop/src/main/**/*.js",
    ],

    rules: {
      "import/no-unresolved": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
    },
  },

  {
    files: [
      "./packages/studio-base/src/players/UserScriptPlayer/transformerWorker/typescript/userUtils/**/*.ts",
      "./packages/studio-base/src/players/UserScriptPlayer/transformerWorker/typescript/userUtils/**/*.js",
    ],

    rules: {
      "@foxglove/license-header": "off",
    },
  },
);
