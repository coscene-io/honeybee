// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { parseMessagePath } from "@foxglove/message-path";

import { validateMessagePathFunctions } from "@foxglove/studio-base/components/MessagePathSyntax/messagePathFunctions";

describe("panel FoxQL flags", () => {
  const plot = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: true,
    globalVariables: {},
  };
  const gauge = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: false,
    globalVariables: {},
  };

  it("plot allows derivative; gauge does not", () => {
    const parsed = parseMessagePath("/t.v.@derivative")!;
    expect(validateMessagePathFunctions(parsed, plot)).toBeUndefined();
    expect(validateMessagePathFunctions(parsed, gauge)).toBeDefined();
  });
});
