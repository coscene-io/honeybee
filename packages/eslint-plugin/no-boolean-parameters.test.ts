// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./no-boolean-parameters") as TSESLint.RuleModule<
  "booleanTrap" | "useStringUnion" | "wrapInObject",
  [{ allowLoneParameter?: boolean }]
>;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      tsconfigRootDir: path.join(__dirname, "fixture"),
      project: "tsconfig.json",
    },
  },
});

ruleTester.run("no-boolean-parameters", rule, {
  valid: [
    { code: "function setMode(mode: 'enabled' | 'disabled') {}", filename: "file.ts" },
    { code: "function setCount(count: number) {}", filename: "file.ts" },
    {
      code: "function setEnabled(enabled: boolean) {}",
      filename: "file.ts",
      options: [{ allowLoneParameter: true }],
    },
    {
      code: "function setValue(value: boolean | string) {}",
      filename: "file.ts",
    },
  ],
  invalid: [
    {
      code: "function setEnabled(enabled: boolean, count: number) {}",
      filename: "file.ts",
      errors: [
        {
          messageId: "booleanTrap",
          suggestions: [
            {
              messageId: "useStringUnion",
              output: 'function setEnabled(enabled: "enabled" | "disabled", count: number) {}',
            },
            {
              messageId: "wrapInObject",
              output: "function setEnabled({ enabled }: { enabled: boolean }, count: number) {}",
            },
          ],
        },
      ],
    },
    {
      code: "const setEnabled = (enabled: boolean | undefined = false, count = 0) => {};",
      filename: "file.ts",
      errors: [
        {
          messageId: "booleanTrap",
          suggestions: [
            {
              messageId: "useStringUnion",
              output:
                'const setEnabled = (enabled: "enabled" | "disabled" | undefined = "disabled", count = 0) => {};',
            },
            {
              messageId: "wrapInObject",
              output:
                "const setEnabled = ({ enabled = false }: { enabled: boolean | undefined }, count = 0) => {};",
            },
          ],
        },
      ],
    },
  ],
});
