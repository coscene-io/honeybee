// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./no-regexp-lookbehind-assertions") as TSESLint.RuleModule<"unsupported">;

new RuleTester({ languageOptions: { ecmaVersion: "latest" } }).run(
  "no-regexp-lookbehind-assertions",
  rule,
  {
    valid: [
      "const pattern = /(?=prefix)value/;",
      "const pattern = new RegExp(source);",
      "function run(RegExp) { return new RegExp('(?<=prefix)value'); }",
      "const pattern = new RegExp('[');",
    ],
    invalid: [
      {
        code: "const pattern = /(?<=prefix)value/;",
        errors: [{ messageId: "unsupported" }],
      },
      {
        code: "const pattern = RegExp('(?<!prefix)value');",
        errors: [{ messageId: "unsupported" }],
      },
      {
        code: "const pattern = new RegExp(`(?<=prefix)value`, 'u');",
        errors: [{ messageId: "unsupported" }],
      },
    ],
  },
);
