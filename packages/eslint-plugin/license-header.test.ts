// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "@typescript-eslint/rule-tester";
import { TSESLint } from "@typescript-eslint/utils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("./license-header") as TSESLint.RuleModule<never>;

const header = `// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/`;

new RuleTester({ languageOptions: { ecmaVersion: "latest" } }).run("license-header", rule, {
  valid: [
    `${header}\n\nconst value = 1;`,
    `/** @jest-environment jsdom */\n${header}\n\nconst value = 1;`,
  ],
  invalid: [
    {
      code: "const value = 1;",
      output: `${header}\n\nconst value = 1;`,
      errors: [{ message: "Missing license header" }],
    },
  ],
});
