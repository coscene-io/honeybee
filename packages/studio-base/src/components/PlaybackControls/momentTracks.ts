// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Property } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import type { MomentCustomFieldSchema } from "@foxglove/studio-base/services/api/moment-custom-field/types";

import {
  getCachedEventLaneLayout,
  type EventLaneLayout,
  type EventLaneLayoutItem,
} from "./eventLanes";
import type { TimelineViewport } from "./timelineViewport";

export type MomentTrack = {
  id: string;
  title: string;
  fieldName: string;
  depth: number;
  kind: "value" | "unknown" | "missing" | "ungrouped";
  /** Includes this group's own Moments and all descendants. */
  count: number;
  children: MomentTrack[];
  /** Moments attached directly to this group, even when it also has children. */
  events: TimelinePositionedEvent[];
};
export type MomentTrackView = {
  collapsed?: Record<string, boolean>;
  /** Hiding a group suppresses its entire subtree without changing child preferences. */
  hidden?: Record<string, boolean>;
};
export type MomentTimelineSettings = {
  doubtfulOnly?: boolean;
  labelWidth: number;
  views: Record<string, MomentTrackView>;
};
export const DEFAULT_MOMENT_TIMELINE_SETTINGS: MomentTimelineSettings = {
  labelWidth: 220,
  views: {},
};
export const EMPTY_TRACK_VIEW: MomentTrackView = {};
export type MomentTrackRow = {
  track: MomentTrack;
  lane: number;
  laneCount: number;
  collapsed: boolean;
  hidden: boolean;
};
export type MomentTrackLayout = EventLaneLayout & { rows: MomentTrackRow[] };

/** Ignore saved collapse flags when a node is now a leaf, including after filtering. */
export function isMomentTrackCollapsed(track: MomentTrack, view: MomentTrackView): boolean {
  return track.children.length > 0 && view.collapsed?.[track.id] === true;
}

// Explicit UTF-16 order is stable across browser languages and ICU versions.
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function getGroupingProperties(schema?: MomentCustomFieldSchema): Property[] {
  const properties = new Map(schema?.properties.map((property) => [property.id, property]));
  const seen = new Set<string>();
  const result: Property[] = [];
  for (const rule of schema?.groupingRules ?? []) {
    const property = properties.get(rule.propertyId);
    if (property?.type.case !== "enums" || property.type.value.multiple || seen.has(property.id)) {
      continue;
    }
    seen.add(property.id);
    result.push(property);
    if (result.length === 5) {
      break;
    }
  }
  return result;
}

type GroupValue = { key: string; title: string; kind: MomentTrack["kind"] };
function getGroupValue(entry: TimelinePositionedEvent, property: Property): GroupValue {
  const field = entry.event.customFieldValues.find((value) => value.property?.id === property.id);
  if (field?.value.case == undefined) {
    return { key: '["missing"]', title: "", kind: "missing" };
  }
  if (field.value.case !== "enums") {
    return { key: JSON.stringify(["invalid", field.value.case])!, title: "", kind: "unknown" };
  }
  const value = field.value.value;
  // Older values may use ids even for a single-select field. Retain malformed multi-values
  // in their own bucket rather than selecting an arbitrary option or dropping the Moment.
  const ids = value.id !== "" ? [value.id] : [...new Set(value.ids)].sort(compareText);
  if (ids.length === 0) {
    return { key: '["missing"]', title: "", kind: "missing" };
  }
  const id = ids[0]!;
  const options = property.type.case === "enums" ? property.type.value.values : {};
  const known = ids.length === 1 && Object.hasOwn(options, id);
  return {
    key: JSON.stringify(["option", ids])!,
    title: known ? options[id]! : ids.join(", "),
    kind: known ? "value" : "unknown",
  };
}

/** Skip unfilled fields; each occupied path can contain both Moments and child groups. */
export function getMomentTracks(
  events: TimelinePositionedEvent[],
  schema?: MomentCustomFieldSchema,
  projectName?: string,
): MomentTrack[] {
  const properties = getGroupingProperties(schema);
  if (properties.length === 0) {
    return [
      {
        id: '["moment-groups/v1"]',
        title: "",
        fieldName: "",
        depth: 0,
        kind: "ungrouped",
        count: events.length,
        children: [],
        events,
      },
    ];
  }
  const roots: MomentTrack[] = [];
  const nodes = new Map<string, MomentTrack>();
  const ungroupedEvents: TimelinePositionedEvent[] = [];
  for (const event of events) {
    if (
      projectName != undefined &&
      !event.event.name.startsWith(`${projectName}/events/`) &&
      !event.event.record.startsWith(`${projectName}/records/`)
    ) {
      // A playlist can span projects with unrelated field/option IDs. Keep foreign or
      // unscoped Moments visible without interpreting them with this project's schema.
      ungroupedEvents.push(event);
      continue;
    }
    let children = roots;
    let parent: MomentTrack | undefined;
    const path: string[][] = [];
    for (const property of properties) {
      const value = getGroupValue(event, property);
      if (value.kind === "missing") {
        continue;
      }
      path.push([property.id, value.key]);
      const id = JSON.stringify(["moment-groups/v1", path])!;
      let node = nodes.get(id);
      if (node == undefined) {
        node = {
          id,
          title: value.title,
          kind: value.kind,
          fieldName: property.name,
          depth: path.length - 1,
          count: 0,
          children: [],
          events: [],
        };
        nodes.set(id, node);
        children.push(node);
      }
      node.count++;
      parent = node;
      children = node.children;
    }
    if (parent == undefined) {
      // Fully unfilled Moments share one root track, without placeholder ancestors.
      const id = '["moment-groups/v1"]';
      parent = nodes.get(id);
      if (parent == undefined) {
        parent = {
          id,
          title: "",
          fieldName: "",
          depth: 0,
          kind: "missing",
          count: 0,
          children: [],
          events: [],
        };
        nodes.set(id, parent);
        roots.push(parent);
      }
      parent.count++;
    }
    parent.events.push(event);
  }
  if (ungroupedEvents.length > 0) {
    roots.push({
      id: '["moment-groups/v1","ungrouped-projects"]',
      title: "",
      fieldName: "",
      depth: 0,
      kind: "ungrouped",
      count: ungroupedEvents.length,
      children: [],
      events: ungroupedEvents,
    });
  }
  const rank = { value: 0, unknown: 1, missing: 2, ungrouped: 3 };
  const sort = (tracks: MomentTrack[]) => {
    tracks.sort((left, right) => {
      const kindOrder = rank[left.kind] - rank[right.kind];
      if (kindOrder !== 0) {
        return kindOrder;
      }
      const nameOrder = compareText(left.title.normalize("NFC"), right.title.normalize("NFC"));
      return nameOrder !== 0 ? nameOrder : compareText(left.id, right.id);
    });
    tracks.forEach((track) => {
      sort(track.children);
    });
  };
  sort(roots);
  return roots;
}

const projected = new WeakMap<EventLaneLayout, { lane: number; items: EventLaneLayoutItem[] }[]>();
function offsetItems(layout: EventLaneLayout, lane: number): EventLaneLayoutItem[] {
  const cached = projected.get(layout) ?? [];
  const match = cached.find((entry) => entry.lane === lane);
  if (match) {
    return match.items;
  }
  const items = layout.items.map((item) => ({ ...item, lane: item.lane + lane }));
  projected.set(layout, [{ lane, items }, ...cached.slice(0, 1)]);
  return items;
}

/** The label column and bars consume this same row layout, including drag previews. */
export function layoutMomentTracks({
  tracks,
  viewport,
  view,
  overrides,
}: {
  tracks: MomentTrack[];
  viewport: TimelineViewport;
  view: MomentTrackView;
  overrides?: ReadonlyMap<string, TimelinePositionedEvent>;
}): MomentTrackLayout {
  const rows: MomentTrackRow[] = [];
  const items: EventLaneLayoutItem[] = [];
  let laneCount = 0;
  const visit = (track: MomentTrack) => {
    const collapsed = isMomentTrackCollapsed(track, view);
    const hidden = view.hidden?.[track.id] === true;
    let events = track.events;
    if (overrides && events.some((entry) => overrides.has(entry.event.name))) {
      events = events.map((entry) => overrides.get(entry.event.name) ?? entry);
    }
    const layout =
      events.length > 0 && !collapsed && !hidden
        ? getCachedEventLaneLayout({ events, viewport })
        : undefined;
    const lanes = Math.max(1, layout?.laneCount ?? 0);
    rows.push({ track, lane: laneCount, laneCount: lanes, collapsed, hidden });
    if (layout) {
      for (const item of offsetItems(layout, laneCount)) {
        items.push(item);
      }
    }
    laneCount += lanes;
    if (!collapsed && !hidden) {
      track.children.forEach(visit);
    }
  };
  tracks.forEach(visit);
  return { rows, items, laneCount };
}
