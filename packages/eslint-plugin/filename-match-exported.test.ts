// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./filename-match-exported") as TSESLint.RuleModule<
  "indexMismatch" | "mismatch"
>;

new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
}).run("filename-match-exported", rule, {
  valid: [
    { code: "const Widget = 1; export default Widget;", filename: "/src/Widget.ts" },
    { code: "export default function Widget() {}", filename: "/src/Widget.js" },
    { code: "export default () => 1;", filename: "/src/anything.js" },
    {
      code: "const widgets = {}; export default widgets;",
      filename: path.join("/src", "widgets", "index.ts"),
    },
  ],
  invalid: [
    {
      code: "const Widget = 1; export default Widget;",
      filename: "/src/Other.ts",
      errors: [{ messageId: "mismatch" }],
    },
    {
      code: "class Widget {} module.exports = Widget;",
      filename: path.join("/src", "other", "index.js"),
      errors: [{ messageId: "indexMismatch" }],
    },
  ],
});
