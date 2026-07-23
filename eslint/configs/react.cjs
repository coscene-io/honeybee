// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");

const files = ["**/*.{jsx,tsx}"];

module.exports = [
  {
    ...reactPlugin.configs.flat.recommended,
    files,
  },
  {
    files,
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": [
        "error",
        {
          additionalHooks: "(useAsync(?!AppConfigurationValue))|useCallbackWithToast",
        },
      ],
    },
  },
  {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mui/material",
              importNames: ["styled"],
              message: "@mui/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/styles",
              message: "@mui/styles has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@mui/material/styles/styled",
              message: "@mui/styled has performance implications. Use tss-react/mui instead.",
            },
            {
              name: "@emotion/styled",
              message: "@emotion/styled has performance implications. Use tss-react/mui instead.",
            },
          ],
        },
      ],
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
      "react/jsx-curly-brace-presence": ["error", "never"],
      "react/jsx-no-target-blank": ["error", { allowReferrer: true }],
      "react/jsx-uses-react": "off",
      "react/no-unused-prop-types": "error",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
];
