// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Minimum height (px) of the bottom timeline / playback panel. */
export const TIMELINE_MIN_HEIGHT_PX = 126;

/** Maximum height (px) of the bottom timeline / playback panel. */
export const TIMELINE_MAX_HEIGHT_PX = 360;

export const SCRUBBER_TOOLBAR_HEIGHT_PX = 32;
export const TIMELINE_RULER_HEIGHT_PX = 14;
export const BAG_OVERLAY_HEIGHT_PX = 12;
export const TIMELINE_BAG_TO_EVENT_GAP_PX = 4;
export const EVENT_LANE_HEIGHT_PX = 28;
export const TIMELINE_SCROLLBAR_HEIGHT_PX = 12;

export const EVENT_LANE_LAYER_TOP_PX =
  TIMELINE_RULER_HEIGHT_PX + BAG_OVERLAY_HEIGHT_PX + TIMELINE_BAG_TO_EVENT_GAP_PX;

export function getTimelineContentHeight({
  eventLaneCount,
  showEventLanes,
}: {
  eventLaneCount: number;
  showEventLanes: boolean;
}): number {
  if (!showEventLanes) {
    return TIMELINE_RULER_HEIGHT_PX + BAG_OVERLAY_HEIGHT_PX;
  }

  return EVENT_LANE_LAYER_TOP_PX + Math.max(eventLaneCount, 1) * EVENT_LANE_HEIGHT_PX;
}
