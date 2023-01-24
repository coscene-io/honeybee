// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isEqual, keyBy } from "lodash";
import { ReactNode, useState } from "react";
import { createStore, StoreApi } from "zustand";

import { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateContext,
  TimelineInteractionStateStore,
  SyncBounds,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { HoverValue } from "@foxglove/studio-base/types/hoverValue";
import { BagFileInfo } from "@foxglove/studio-base/context/CoSceneRecordContext";

function createTimelineInteractionStateStore(): StoreApi<TimelineInteractionStateStore> {
  return createStore((set) => {
    return {
      eventsAtHoverValue: {},
      bagsAtHoverValue: {},
      globalBounds: undefined,
      hoveredEvent: undefined,
      hoveredBag: undefined,
      hoverValue: undefined,

      clearHoverValue: (componentId: string) =>
        set((store) => ({
          hoverValue: store.hoverValue?.componentId === componentId ? undefined : store.hoverValue,
        })),

      setEventsAtHoverValue: (eventsAtHoverValue: TimelinePositionedEvent[]) =>
        set({ eventsAtHoverValue: keyBy(eventsAtHoverValue, (event) => event.event.getName()) }),

      setBagsAtHoverValue: (bagsAtHoverValue: BagFileInfo[]) =>
        set({ bagsAtHoverValue: keyBy(bagsAtHoverValue, (bag) => bag.name) }),

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
              componentId: `event_${hoveredEvent.event.getName()}`,
              type: "PLAYBACK_SECONDS",
              value: hoveredEvent.secondsSinceStart,
            },
          });
        } else {
          set({ hoveredEvent: undefined, hoverValue: undefined });
        }
      },

      setHoveredBag(hoveredBag: undefined | BagFileInfo) {
        if (hoveredBag) {
          set({
            hoveredBag,
            hoverValue: {
              componentId: `bag_${hoveredBag.name}`,
              type: "PLAYBACK_SECONDS",
              value: hoveredBag.secondsSinceStart,
            },
          });
        }
      },

      setHoverValue: (newValue: HoverValue) =>
        set((store) => ({
          hoverValue: isEqual(newValue, store.hoverValue) ? store.hoverValue : newValue,
        })),
    };
  });
}

export default function TimelineInteractionStateProvider({
  children,
}: {
  children?: ReactNode;
}): JSX.Element {
  const [store] = useState(createTimelineInteractionStateStore());

  return (
    <TimelineInteractionStateContext.Provider value={store}>
      {children}
    </TimelineInteractionStateContext.Provider>
  );
}
