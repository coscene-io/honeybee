// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { ReactNode, useState } from "react";
import { createStore, StoreApi } from "zustand";

import { BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateContext,
  TimelineInteractionStateStore,
  SyncBounds,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { HoverValue } from "@foxglove/studio-base/types/hoverValue";

function createTimelineInteractionStateStore(): StoreApi<TimelineInteractionStateStore> {
  return createStore((set) => {
    return {
      eventsAtHoverValue: {},
      bagsAtHoverValue: {},
      globalBounds: undefined,
      hoveredEvent: undefined,
      hoveredBag: undefined,
      hoverValue: undefined,
      loopedEvent: undefined,

      clearHoverValue: (componentId: string) => {
        set((store) => ({
          hoverValue: store.hoverValue?.componentId === componentId ? undefined : store.hoverValue,
        }));
      },

      setEventsAtHoverValue: (eventsAtHoverValue: TimelinePositionedEvent[]) => {
        // CoScene
        set({ eventsAtHoverValue: _.keyBy(eventsAtHoverValue, (event) => event.event.name) });
      },

      setGlobalBounds: (
        newBounds:
          | undefined
          | SyncBounds
          | ((oldValue: undefined | SyncBounds) => undefined | SyncBounds),
      ) => {
        if (typeof newBounds === "function") {
          set((store) => ({ globalBounds: newBounds(store.globalBounds) }));
        } else {
          set({ globalBounds: newBounds });
        }
      },

      setHoveredEvent: (hoveredEvent: undefined | TimelinePositionedEvent) => {
        if (hoveredEvent) {
          set({
            hoveredEvent,
            hoverValue: {
              componentId: `event_${hoveredEvent.event.name}`,
              type: "PLAYBACK_SECONDS",
              value: hoveredEvent.secondsSinceStart,
            },
          });
        } else {
          set({ hoveredEvent: undefined, hoverValue: undefined });
        }
      },

      setHoverValue: (newValue: HoverValue) => {
        set((store) => ({
          hoverValue: _.isEqual(newValue, store.hoverValue) ? store.hoverValue : newValue,
        }));
      },

      // CoScene
      setBagsAtHoverValue: (bagsAtHoverValue: BagFileInfo[]) => {
        set({ bagsAtHoverValue: _.keyBy(bagsAtHoverValue, (bag) => bag.name) });
      },

      setHoveredBag(hoveredBag: undefined | BagFileInfo) {
        if (hoveredBag?.secondsSinceStart != undefined) {
          set({
            hoveredBag,
            hoverValue: {
              componentId: `bag_${hoveredBag.name}`,
              type: "PLAYBACK_SECONDS",
              value: hoveredBag.secondsSinceStart,
            },
          });
        } else {
          set({ hoveredBag: undefined, hoverValue: undefined });
        }
      },

      setLoopedEvent: (loopedEvent: undefined | TimelinePositionedEvent) => {
        set({ loopedEvent });
      },
    };
  });
}

export default function TimelineInteractionStateProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(createTimelineInteractionStateStore());

  return (
    <TimelineInteractionStateContext.Provider value={store}>
      {children}
    </TimelineInteractionStateContext.Provider>
  );
}
