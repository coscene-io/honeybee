// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

type WebpackArgv = {
  mode?: string;
  env?: {
    WEBPACK_SERVE?: "true" | "false";
    WEBPACK_BUNDLE?: boolean;
    WEBPACK_BUILD?: boolean;
  };
  host?: string;
};

export type { WebpackArgv };
