// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

export const PLAYBACK_SPEED_OPTIONS: PlaybackSpeed[] = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 1, 2, 3, 5,
];

export type PlaybackSpeedDirection = "decrease" | "increase";

export const formatPlaybackSpeed = (val: PlaybackSpeed): string =>
  `${val < 0.1 ? val.toFixed(2) : val}×`;

export function stepPlaybackSpeed(
  currentSpeed: PlaybackSpeed,
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
