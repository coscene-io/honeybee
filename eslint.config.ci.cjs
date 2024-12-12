// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// We keep some slow lint rules here, and only run them in CI.
// Please only add rules here if they are unlikely to be encountered
// during normal development.
const baseConfig = require("./eslint.config.cjs");

module.exports = [
  ...baseConfig,
  {
    rules: {
      // disable progress spinner
      "file-progress/activate": "off",
      // VScode is already configured to run prettier on save
      "prettier/prettier": "error",
      // Common sense should prevent triggering this in development
      "import/no-self-import": "error",
      // https://github.com/import-js/eslint-plugin-import/issues/242#issuecomment-230118951
      "import/no-duplicates": "error",
      // https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md
      "import/no-cycle": [
        "error",
        {
          ignoreExternal: true,
        },
      ],
    },
  },
];
