// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// This root-level fixture is not currently discovered by the repository's Jest projects.

// eslint-disable-next-line jest/no-standalone-expect
expect(true).toBe(true);

it("remains a valid test if the root directory is discovered", () => {
  expect(true).toBe(true);
});
