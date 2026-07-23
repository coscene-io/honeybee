// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const jestPlugin = require("eslint-plugin-jest");

const files = ["**/*.test.{js,jsx,ts,tsx}"];
const recommended = jestPlugin.configs["flat/recommended"];

module.exports = [
  {
    ...recommended,
    files,
    rules: {
      ...recommended.rules,
      "jest/consistent-test-it": ["error", { fn: "it" }],
      // Many data-driven tests place assertions inside loops and callback-driven state machines.
      "jest/no-conditional-expect": "off",
      "jest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect*", "sendNotification.expectCalledDuringTest"],
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
