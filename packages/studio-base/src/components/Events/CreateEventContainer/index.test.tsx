// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getEventDurationSeconds } from ".";

describe("getEventDurationSeconds", () => {
  it("clamps negative second durations to zero", () => {
    expect(getEventDurationSeconds(-1.25, "sec")).toBe(0);
  });

  it("clamps negative nanosecond durations to zero", () => {
    expect(getEventDurationSeconds(-1_250_000_000, "nsec")).toBe(0);
  });

  it("converts positive nanosecond durations to seconds", () => {
    expect(getEventDurationSeconds(1_250_000_000, "nsec")).toBe(1.25);
  });
});
