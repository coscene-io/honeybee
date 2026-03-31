// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { formatPlaybackSpeed, stepPlaybackSpeed } from "./playbackSpeed";

describe("playbackSpeed", () => {
  it("formats playback speed for display", () => {
    expect(formatPlaybackSpeed(0.05)).toBe("0.05×");
    expect(formatPlaybackSpeed(1)).toBe("1×");
  });

  it("steps to the previous or next preset when current speed is a preset", () => {
    expect(stepPlaybackSpeed(1, "decrease")).toBe(0.8);
    expect(stepPlaybackSpeed(1, "increase")).toBe(2);
  });

  it("snaps to adjacent presets when current speed is between presets", () => {
    expect(stepPlaybackSpeed(0.9, "decrease")).toBe(0.8);
    expect(stepPlaybackSpeed(0.9, "increase")).toBe(1);
  });

  it("clamps to the preset boundaries", () => {
    expect(stepPlaybackSpeed(0.001, "decrease")).toBe(0.01);
    expect(stepPlaybackSpeed(10, "increase")).toBe(5);
  });
});
