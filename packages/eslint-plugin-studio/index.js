// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

module.exports = {
  rules: {
    "link-target": require("./link-target"),
    "lodash-ramda-imports": require("./lodash-ramda-imports"),
    "ramda-usage": require("./ramda-usage"),
    "no-map-type-argument": require("./no-map-type-argument"),
    "license-header": require("./license-header"),
  },

  configs: {
    all: {
      plugins: ["@foxglove/studio"],
      rules: {
        "@foxglove/studio/link-target": "error",
        "@foxglove/studio/lodash-ramda-imports": "error",
        "@foxglove/studio/ramda-usage": "error",
        "@foxglove/studio/no-map-type-argument": "error",
        "@foxglove/studio/license-header": "error",
      },
    },
  },
};
