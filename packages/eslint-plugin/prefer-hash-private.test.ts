// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./prefer-hash-private") as TSESLint.RuleModule<"preferHash" | "rename">;

new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
}).run("prefer-hash-private", rule, {
  valid: [
    "class Example { #value = 1; read() { return this.#value; } }",
    "class Example { public value = 1; }",
    "class Example { private ['value'] = 1; }",
  ],
  invalid: [
    {
      code: "class Example { private value = 1; read() { return this.value; } }",
      errors: [
        {
          messageId: "preferHash",
          suggestions: [
            {
              messageId: "rename",
              output: "class Example { #value = 1; read() { return this.#value; } }",
            },
          ],
        },
      ],
    },
    {
      code: "class Example { private static _value = 1; static read() { return Example._value; } }",
      errors: [
        {
          messageId: "preferHash",
          suggestions: [
            {
              messageId: "rename",
              output:
                "class Example { static #value = 1; static read() { return Example.#value; } }",
            },
          ],
        },
      ],
    },
  ],
});
