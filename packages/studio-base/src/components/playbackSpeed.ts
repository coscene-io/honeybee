// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

export const PLAYBACK_SPEED_OPTIONS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8,
  8.5, 9, 9.5, 10,
] as const satisfies readonly PlaybackSpeed[];

export type PlaybackSpeedDirection = "decrease" | "increase";

export const formatPlaybackSpeed = (val: PlaybackSpeed): string =>
  `${val < 0.1 ? val.toFixed(2) : val}×`;

export function stepPlaybackSpeed(
  currentSpeed: number,
  direction: PlaybackSpeedDirection,
): PlaybackSpeed {
  if (direction === "increase") {
    const nextOption = PLAYBACK_SPEED_OPTIONS.find((option) => option > currentSpeed);
    return nextOption ?? PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1]!;
  }

  const currentOrHigherOptionIndex = PLAYBACK_SPEED_OPTIONS.findIndex(
    (option) => option >= currentSpeed,
  );

  if (currentOrHigherOptionIndex === -1) {
    return PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1]!;
  }

  return PLAYBACK_SPEED_OPTIONS[Math.max(currentOrHigherOptionIndex - 1, 0)]!;
}

export function fractionToPlaybackSpeed(fraction: number): PlaybackSpeed {
  const clamped = Math.min(1, Math.max(0, fraction));
  const lastIndex = PLAYBACK_SPEED_OPTIONS.length - 1;
  const index = Math.round(clamped * lastIndex);
  return PLAYBACK_SPEED_OPTIONS[index]!;
}

export function playbackSpeedToFraction(speed: PlaybackSpeed): number {
  const lastIndex = PLAYBACK_SPEED_OPTIONS.length - 1;
  const index = PLAYBACK_SPEED_OPTIONS.indexOf(speed);
  if (index < 0) {
    return playbackSpeedToFraction(1);
  }
  return index / lastIndex;
}
