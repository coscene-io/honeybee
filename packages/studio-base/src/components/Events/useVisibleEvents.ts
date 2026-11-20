// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { useMemo } from "react";

import { EMPTY_EVENTS } from "@foxglove/studio-base/components/PlaybackControls/eventTimeIndex";
import { isMomentInProject } from "@foxglove/studio-base/components/PlaybackControls/momentTracks";
import {
  useEvents,
  type TimelinePositionedEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

import { isMomentDoubtful } from "./momentDoubtful";

function bareUserId(id: string): string {
  return id.startsWith("users/") ? id.slice("users/".length) : id;
}

export function matchesMomentField(
  value: CustomFieldValue["value"],
  filter: CustomFieldValue["value"],
): boolean {
  switch (filter.case) {
    case "text":
      return (
        value.case === "text" &&
        value.value.value.toLowerCase().includes(filter.value.value.toLowerCase())
      );
    case "number":
      return value.case === "number" && value.value.value === filter.value.value;
    case "enums": {
      if (value.case !== "enums") {
        return false;
      }
      const ids = [value.value.id, ...value.value.ids];
      return [filter.value.id, ...filter.value.ids].some((id) => id !== "" && ids.includes(id));
    }
    case "time": {
      const actual = value.case === "time" ? value.value.value : undefined;
      const expected = filter.value.value;
      // The field picker accepts values to minute precision.
      return (
        actual != undefined &&
        expected != undefined &&
        Math.floor(timestampDate(actual).getTime() / 60_000) ===
          Math.floor(timestampDate(expected).getTime() / 60_000)
      );
    }
    case "user": {
      const ids = value.case === "user" ? value.value.ids.map(bareUserId) : [];
      return filter.value.ids.map(bareUserId).some((id) => id !== "" && ids.includes(id));
    }
    case undefined:
      return false;
  }
}

/** The display projection leaves the full collection available to editing and bulk actions. */
export function useVisibleEvents(): TimelinePositionedEvent[] {
  const events = useEvents((store) => store.events.value ?? EMPTY_EVENTS);
  const filters = useEvents((store) => store.customFieldFilters);
  const projectName = useEvents((store) => store.customFieldSchemaProjectName);
  const doubtfulOnly = useWorkspaceStore(
    (store) => store.playbackControls.momentTimeline?.doubtfulOnly ?? false,
  );
  return useMemo(() => {
    const fieldFilters = filters != undefined && projectName != undefined ? [...filters] : [];
    if (!doubtfulOnly && fieldFilters.length === 0) {
      return events;
    }
    return events.filter(
      (entry) =>
        (!doubtfulOnly || isMomentDoubtful(entry.event.customizedFields)) &&
        (fieldFilters.length === 0 ||
          (isMomentInProject(entry, projectName) &&
            fieldFilters.every(([id, filter]) =>
              entry.event.customFieldValues.some(
                (field) => field.property?.id === id && matchesMomentField(field.value, filter),
              ),
            ))),
    );
  }, [events, filters, projectName, doubtfulOnly]);
}
