// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./strict-equality") as TSESLint.RuleModule<
  "requireLooseNullish" | "requireStrict"
>;

new RuleTester({ languageOptions: { ecmaVersion: "latest" } }).run("strict-equality", rule, {
  valid: ["value === 1;", "value !== '1';", "value == null;", "value != undefined;"],
  invalid: [
    {
      code: "value == 1;",
      errors: [
        { messageId: "requireStrict", data: { actualOperator: "==", expectedOperator: "===" } },
      ],
    },
    {
      code: "value !== undefined;",
      errors: [{ messageId: "requireLooseNullish", data: { expectedOperator: "!=" } }],
    },
    {
      code: "value === null;",
      errors: [{ messageId: "requireLooseNullish", data: { expectedOperator: "==" } }],
    },
  ],
});
