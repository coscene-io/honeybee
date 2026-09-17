// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  PLAYBACK_SPEED_OPTIONS,
  formatPlaybackSpeed,
  fractionToPlaybackSpeed,
  playbackSpeedToFraction,
  stepPlaybackSpeed,
} from "./playbackSpeed";

describe("playbackSpeed", () => {
  it("lists every selectable preset in index order", () => {
    expect([...PLAYBACK_SPEED_OPTIONS]).toEqual([
      0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7,
      7.5, 8, 8.5, 9, 9.5, 10,
    ]);
  });

  it("formats playback speed for display", () => {
    expect(formatPlaybackSpeed(0.05)).toBe("0.05×");
    expect(formatPlaybackSpeed(1)).toBe("1×");
    expect(formatPlaybackSpeed(1.5)).toBe("1.5×");
    expect(formatPlaybackSpeed(10)).toBe("10×");
  });

  it("steps to the previous or next preset when current speed is a preset", () => {
    expect(stepPlaybackSpeed(1, "decrease")).toBe(0.8);
    expect(stepPlaybackSpeed(1, "increase")).toBe(1.5);
    expect(stepPlaybackSpeed(1.5, "decrease")).toBe(1);
    expect(stepPlaybackSpeed(9.5, "increase")).toBe(10);
  });

  it("snaps to adjacent presets when current speed is between presets", () => {
    expect(stepPlaybackSpeed(0.9, "decrease")).toBe(0.8);
    expect(stepPlaybackSpeed(0.9, "increase")).toBe(1);
    expect(stepPlaybackSpeed(1.2, "increase")).toBe(1.5);
  });

  it("clamps to the preset boundaries", () => {
    expect(stepPlaybackSpeed(0.001, "decrease")).toBe(0.01);
    expect(stepPlaybackSpeed(10, "increase")).toBe(10);
  });

  it("maps slider fraction to the nearest preset by index", () => {
    expect(fractionToPlaybackSpeed(0)).toBe(0.01);
    expect(fractionToPlaybackSpeed(1)).toBe(10);
    expect(fractionToPlaybackSpeed(-1)).toBe(0.01);
    expect(fractionToPlaybackSpeed(2)).toBe(10);
    expect(fractionToPlaybackSpeed(7 / 25)).toBe(1);
    expect(fractionToPlaybackSpeed(8 / 25)).toBe(1.5);
  });

  it("round-trips each preset through fraction mapping", () => {
    for (const speed of PLAYBACK_SPEED_OPTIONS) {
      expect(fractionToPlaybackSpeed(playbackSpeedToFraction(speed))).toBe(speed);
    }
  });
});
