// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./link-target") as TSESLint.RuleModule<never>;

new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run("link-target", rule, {
  valid: ['const link = <a href="/" target="_self">Home</a>;'],
  invalid: [
    {
      code: 'const link = <a href="/">Home</a>;',
      errors: [
        {
          message: "Links must specify a target",
          suggestions: [
            {
              desc: 'Add target="_blank"',
              output: 'const link = <a href="/" target="_blank">Home</a>;',
            },
            {
              desc: 'Add target="_self" (the default)',
              output: 'const link = <a href="/" target="_self">Home</a>;',
            },
          ],
        },
      ],
    },
  ],
});
