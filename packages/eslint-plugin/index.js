// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

module.exports = {
  rules: {
    "filename-match-exported": require("./filename-match-exported"),
    "link-target": require("./link-target"),
    "lodash-ramda-imports": require("./lodash-ramda-imports"),
    "no-boolean-parameters": require("./no-boolean-parameters"),
    "no-map-type-argument": require("./no-map-type-argument"),
    "no-regexp-lookbehind-assertions": require("./no-regexp-lookbehind-assertions"),
    "no-return-promise-resolve": require("./no-return-promise-resolve"),
    "prefer-hash-private": require("./prefer-hash-private"),
    "ramda-usage": require("./ramda-usage"),
    "strict-equality": require("./strict-equality"),
    "license-header": require("./license-header"),
  },
};
