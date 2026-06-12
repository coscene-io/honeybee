// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Marker attribute placed on the timeline scrubber root so that timeline keyboard shortcuts
 * (select/seek/edit moments, zoom) can scope themselves to "focus is on the timeline" instead
 * of firing globally and clashing with other panels (e.g. the Table / Raw Message panels'
 * arrow-key navigation). Set it on the focusable scrubber container.
 */
export const TIMELINE_SCRUBBER_ATTRIBUTE = "data-timeline-scrubber";

/**
 * True when a keydown originated while focus is within the timeline scrubber. Because keydown
 * fires on the focused element, checking the event target tells us whether the timeline owns
 * focus without any cross-component refs.
 */
export function isTimelineKeyboardEvent(event: KeyboardEvent): boolean {
  const { target } = event;
  return (
    target instanceof HTMLElement && target.closest(`[${TIMELINE_SCRUBBER_ATTRIBUTE}]`) != undefined
  );
}
