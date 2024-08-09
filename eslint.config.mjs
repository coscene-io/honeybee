import fileProgress from "eslint-plugin-file-progress";
import tssUnusedClasses from "eslint-plugin-tss-unused-classes";
import foxgloveEslintPluginStudio from "@foxglove/eslint-plugin-studio";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      "**/dist",
      "**/out",
      "**/template",
      "packages/**/wasm/*.js",
      "!**/.storybook",
      "**/storybook-static",
    ],
  },
  ...compat.extends(
    "plugin:@foxglove/base",
    "plugin:@foxglove/react",
    "plugin:@foxglove/jest",
    "plugin:storybook/recommended",
    "plugin:@foxglove/studio/all",
  ),
  {
    plugins: {
      "file-progress": fileProgress,
      "tss-unused-classes": tssUnusedClasses,
      "@foxglove/studio": foxgloveEslintPluginStudio,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    settings: {
      "import/internal-regex": "^@foxglove",
    },

    rules: {
      "@foxglove/license-header": "error",
      "@foxglove/prefer-hash-private": "error",
      "tss-unused-classes/unused-classes": "error",
      "file-progress/activate": "warn",
      "prettier/prettier": "off",
      "import/no-self-import": "off",
      "import/no-duplicates": "off",
      "id-denylist": ["error", "useEffectOnce", "window"],
      "no-console": "off",
      "react/jsx-uses-react": "off",
      "react/prop-types": "off",

      "react-hooks/exhaustive-deps": [
        "error",
        {
          additionalHooks: "(useAsync(?!AppConfigurationValue))|useCallbackWithToast",
        },
      ],

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

      "no-warning-comments": [
        "error",
        {
          terms: ["fixme", "xxx", "todo"],
          location: "anywhere",
        },
      ],

      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@emotion/styled",
              importNames: ["styled"],
              message: "@emotion/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/material",
              importNames: ["styled"],
              message: "@mui/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/system",
              importNames: ["styled"],
              message: "@mui/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/material/styles/styled",
              message: "@mui/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/material",
              importNames: ["Box"],
              message: "@mui/Box has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/system",
              importNames: ["Box"],
              message: "@mui/Box has performance implications. Use tss-react/mui instead.",
            },
          ],
        },
      ],

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

      "jest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect*", "sendNotification.expectCalledDuringTest"],
        },
      ],
    },
  },
  ...compat.extends("plugin:@foxglove/typescript").map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],

    languageOptions: {
      ecmaVersion: 5,
      sourceType: "script",

      parserOptions: {
        project: "./tsconfig.eslint.json",
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
];
