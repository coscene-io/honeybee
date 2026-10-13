// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useLayoutEffect, useState, type RefObject } from "react";

import { EVENT_LANE_HEIGHT_PX } from "./constants";

export function useVisibleEventLanes(
  root: RefObject<HTMLDivElement>,
  laneCount: number,
): { first: number; last: number } {
  const [range, setRange] = useState({ first: 0, last: 13 });
  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest<HTMLElement>("[data-timeline-scroll-container]");
    if (element == undefined || scroll == undefined) {
      setRange({ first: 0, last: laneCount - 1 });
      return;
    }
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      const rect = element.getBoundingClientRect();
      const visible = scroll.getBoundingClientRect();
      if (visible.height === 0) {
        return;
      }
      const laneTop = rect.top + (rect.height - Math.max(1, laneCount) * EVENT_LANE_HEIGHT_PX) / 2;
      const first = Math.max(0, Math.floor((visible.top - laneTop) / EVENT_LANE_HEIGHT_PX) - 2);
      const last = Math.min(
        laneCount - 1,
        Math.ceil((visible.bottom - laneTop) / EVENT_LANE_HEIGHT_PX) + 2,
      );
      setRange((old) => (old.first === first && old.last === last ? old : { first, last }));
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(scroll);
    scroll.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
      if (frame != undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [root, laneCount]);
  return range;
}
