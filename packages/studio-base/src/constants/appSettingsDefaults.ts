// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";

export const REQUEST_WINDOW_DEFAULT_SECONDS = 10;
export const READ_AHEAD_DURATION_DEFAULT_SECONDS = 20;
export const READ_AHEAD_DURATION_MIN_SECONDS = 1;

export function getRequestWindowDefaultTime(): Time {
  return {
    sec: REQUEST_WINDOW_DEFAULT_SECONDS,
    nsec: 0,
  };
}

export function getReadAheadDurationDefaultTime(): Time {
  return {
    sec: READ_AHEAD_DURATION_DEFAULT_SECONDS,
    nsec: 0,
  };
}

export function getReadAheadDurationMinTime(): Time {
  return {
    sec: READ_AHEAD_DURATION_MIN_SECONDS,
    nsec: 0,
  };
}
