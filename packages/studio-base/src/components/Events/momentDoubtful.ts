// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import { EMPTY_EVENTS } from "@foxglove/studio-base/components/PlaybackControls/eventTimeIndex";
import {
  useEvents,
  type TimelinePositionedEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

export const DOUBTFUL_MOMENT_COLOR = "#FF4D4F";
export const DOUBTFUL_FIELD_KEY = "_doubtful";
export function isMomentDoubtful(fields: Readonly<Record<string, string>>): boolean {
  return fields[DOUBTFUL_FIELD_KEY] === "true";
}

export function buildMomentCustomizedFields({
  fields,
  isDoubtful,
}: {
  fields: Readonly<Record<string, string>>;
  isDoubtful: boolean;
}): Record<string, string> {
  const result = { ...fields };
  delete result[DOUBTFUL_FIELD_KEY];
  if (isDoubtful) {
    result[DOUBTFUL_FIELD_KEY] = "true";
  }
  return result;
}

/** Filtering is a display projection; edits and bulk operations retain the complete store. */
export function useVisibleEvents(): TimelinePositionedEvent[] {
  const events = useEvents((store) => store.events.value ?? EMPTY_EVENTS);
  const doubtfulOnly = useWorkspaceStore(
    (store) => store.playbackControls.momentTimeline?.doubtfulOnly ?? false,
  );
  return useMemo(
    () =>
      doubtfulOnly
        ? events.filter((entry) => isMomentDoubtful(entry.event.customizedFields))
        : events,
    [events, doubtfulOnly],
  );
}
