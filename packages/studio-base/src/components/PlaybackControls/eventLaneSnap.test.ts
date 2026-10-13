// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import { LaneSnapCache, snapRangeToLaneBoundaries } from "./eventLaneSnap";
import { referenceSnapRangeToLaneBoundaries } from "./eventLaneSnap.testUtils";
import { layoutEventLanes } from "./eventLanes";
import { makeTimelineViewport } from "./timelineViewport";

it.each(["continuous", "short", "overlapping", "long"] as const)(
  "preserves body/start/end snapping, lanes and last-wins ties for %s moments",
  (distribution) => {
    const events = makeMomentFixture(200, distribution);
    for (const start of [0, 900, 1800]) {
      const viewport = {
        ...makeTimelineViewport(0, 3600),
        visibleStartSec: start,
        visibleEndSec: start + 1800,
      };
      const layoutItems = layoutEventLanes({ events, viewport }).items;
      for (let index = 0; index < 200; index++) {
        for (const edge of [undefined, "start", "end"] as const) {
          const args = {
            activeEventName: events[index]!.event.name,
            edge,
            lane: index % 3,
            layoutItems,
            viewport,
            range: { startSec: index * 18 + 0.5, endSec: index * 18 + 12 },
          };
          expect(snapRangeToLaneBoundaries(args)).toEqual(referenceSnapRangeToLaneBoundaries(args));
        }
      }
    }
  },
);

it("reuses unchanged neighbour boundaries across drag previews and invalidates changed geometry", () => {
  const viewport = makeTimelineViewport(0, 3600);
  const items = layoutEventLanes({ events: makeMomentFixture(3, "short"), viewport }).items;
  const active = items[0]!;
  const cache = new LaneSnapCache();
  const original = cache.candidates(items, active.lane, active.event.event.name, viewport);
  const preview = items.map((item) => (item === active ? { ...item, startSec: 1 } : item));
  expect(cache.candidates(preview, active.lane, active.event.event.name, viewport)).toBe(original);
  const changed = items.map((item, index) =>
    index === 1 ? { ...item, endSec: item.endSec + 1 } : item,
  );
  expect(cache.candidates(changed, active.lane, active.event.event.name, viewport)).not.toBe(
    original,
  );
  const zoomed = cache.candidates(changed, active.lane, active.event.event.name, {
    ...viewport,
    visibleEndSec: 1800,
  });
  expect(zoomed).not.toBe(original);
  cache.clear();
  expect(
    cache.candidates(changed, active.lane, active.event.event.name, {
      ...viewport,
      visibleEndSec: 1800,
    }),
  ).not.toBe(zoomed);
});
