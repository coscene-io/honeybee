// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ScatterDataPoint } from "chart.js";

import { TimestampMethod } from "@foxglove/studio-base/util/time";

/**
 * Datum represents a single data point in the state transitions chart.
 */
export type Datum = ScatterDataPoint & {
  value?: string | number | bigint | boolean;
  label?: string;
  labelColor?: string;
  constantName?: string;
  /** States included in this downsampled segment (for compressed multi-state intervals) */
  states?: string[];
};

export type StateTransitionPath = {
  color?: string;
  value: string;
  label?: string;
  enabled?: boolean;
  expansionState?: "collapsed" | "expanded";
  timestampMethod: TimestampMethod;
};

export type StateTransitionConfig = {
  isSynced: boolean;
  paths: StateTransitionPath[];
  xAxisMaxValue?: number;
  xAxisMinValue?: number;
  xAxisRange?: number;
  showPoints?: boolean;
};
