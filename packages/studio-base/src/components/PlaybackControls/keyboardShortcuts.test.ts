// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { getCreateMomentShortcut, isMacUserAgent } from "./keyboardShortcuts";

describe("keyboardShortcuts", () => {
  it("uses Option for the create moment shortcut on macOS", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

    expect(isMacUserAgent(userAgent)).toBe(true);
    expect(getCreateMomentShortcut(userAgent)).toBe("Option + 1");
  });

  it("uses Alt for the create moment shortcut on other platforms", () => {
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

    expect(isMacUserAgent(userAgent)).toBe(false);
    expect(getCreateMomentShortcut(userAgent)).toBe("Alt + 1");
  });
});
