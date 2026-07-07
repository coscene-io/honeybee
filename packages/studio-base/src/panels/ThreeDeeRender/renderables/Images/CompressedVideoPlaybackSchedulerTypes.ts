// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type CompressedVideoPlaybackSchedulerResult = Readonly<{
  displayed?: boolean;
  lateDropped?: boolean;
  preDecodeSkipped?: boolean;
  resetJumped?: boolean;
  coalesced?: boolean;
  queuePressured?: boolean;
}>;

export type CompressedVideoPlaybackSchedulerController = Readonly<{
  id: string;
  runPlaybackFlush: () => Promise<CompressedVideoPlaybackSchedulerResult>;
  hasPendingPlayback: () => boolean;
  isPlaybackActive?: () => boolean;
}>;

export type CompressedVideoPlaybackSchedulerConfig = Readonly<{
  maxConcurrentFlushes?: number;
  normalSlotsPerSecond?: number;
  pressureSlotsPerSecond?: number;
  bucketCapacity?: number;
  initialTokens?: number;
  normalControllerIntervalMs?: number;
  pressureControllerIntervalMs?: number;
  pressureMinDurationMs?: number;
  slowFlushThresholdMs?: number;
  lateDropPressureCount?: number;
}>;
