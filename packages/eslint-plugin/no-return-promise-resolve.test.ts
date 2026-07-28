// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./no-return-promise-resolve") as TSESLint.RuleModule<
  "returnDirectly" | "throwDirectly"
>;

new RuleTester({ languageOptions: { ecmaVersion: "latest" } }).run(
  "no-return-promise-resolve",
  rule,
  {
    valid: [
      "async function run() { return value; }",
      "function run() { return Promise.resolve(value); }",
      "async function outer() { return function inner() { return Promise.resolve(value); }; }",
      "async function run() { const promise = Promise.resolve(value); return promise; }",
    ],
    invalid: [
      {
        code: "async function run() { return Promise.resolve(value); }",
        output: "async function run() { return value; }",
        errors: [{ messageId: "returnDirectly" }],
      },
      {
        code: "const run = async () => Promise.resolve({ value: 1 });",
        output: "const run = async () => ({ value: 1 });",
        errors: [{ messageId: "returnDirectly" }],
      },
      {
        code: "async function run() { return Promise.reject(error); }",
        output: "async function run() { throw error; }",
        errors: [{ messageId: "throwDirectly" }],
      },
      {
        code: "const run = async () => Promise.reject();",
        output: "const run = async () => { throw undefined; };",
        errors: [{ messageId: "throwDirectly" }],
      },
    ],
  },
);
