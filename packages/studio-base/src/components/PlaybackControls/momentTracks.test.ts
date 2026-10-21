// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, fromJson } from "@bufbuild/protobuf";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import {
  CustomFieldSchemaSchema,
  PropertySchema,
} from "@foxglove/studio-base/services/api/moment-custom-field/generated/common/custom_field_pb";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import {
  getGroupingProperties,
  getMomentTracks,
  getTrackProperties,
  canHideMomentTrack,
  layoutMomentTracks,
  type MomentTrack,
} from "./momentTracks";
import { makeTimelineViewport } from "./timelineViewport";

const viewport = makeTimelineViewport(0, 3600);
function property(id: string, values: Record<string, string> = { a: "Alpha", b: "Beta" }) {
  return create(PropertySchema, {
    id,
    name: id,
    type: { case: "enums", value: { values, multiple: false } },
  });
}
function schema(ids = ["platform"]) {
  return create(CustomFieldSchemaSchema, {
    properties: ids.map((id) => property(id)),
    groupingRules: ids.map((propertyId) => ({ propertyId })),
  });
}
function event(name: string, fields: Record<string, string> = {}): TimelinePositionedEvent {
  const entry = makeMomentFixture(1)[0]!;
  entry.event.name = name;
  entry.event.customFieldValues = Object.entries(fields).map(([id, option]) =>
    create(CustomFieldValueSchema, {
      property: { id },
      value: { case: "enums", value: { id: option } },
    }),
  );
  return entry;
}
function allTracks(tracks: MomentTrack[]): MomentTrack[] {
  return tracks.flatMap((track) => [track, ...allTracks(track.children)]);
}

describe("project Moment grouping", () => {
  it("retains a single track larger than the JavaScript argument limit", () => {
    const template = event("template");
    const entries = Array.from({ length: 140_000 }, (_, index) => ({
      ...template,
      event: { ...template.event, name: `events/${index}` },
    }));
    const result = layoutMomentTracks({ tracks: getMomentTracks(entries), viewport, view: {} });
    expect(result.items).toHaveLength(entries.length);
    expect(result.laneCount).toBe(entries.length);
    expect(new Set(result.items.map((item) => item.event.event.name)).size).toBe(entries.length);
  });

  it("keeps foreign and unscoped Moments outside the active project's groups", () => {
    const owner = "warehouses/one/projects/active";
    const local = event(`${owner}/events/local`, { platform: "a" });
    const foreign = event("warehouses/one/projects/other/events/foreign", { platform: "a" });
    const otherWarehouse = event("warehouses/two/projects/active/events/foreign", {
      platform: "a",
    });
    const unknown = event("events/unknown", { platform: "a" });
    const missing = event(`${owner}/events/missing`);
    const entries = [local, foreign, otherWarehouse, unknown, missing];
    const tracks = getMomentTracks(entries, schema(), owner);
    expect(tracks.find((track) => track.kind === "value")?.events).toEqual([local]);
    expect(tracks.find((track) => track.kind === "missing")?.events).toEqual([missing]);
    expect(tracks.find((track) => track.kind === "ungrouped")?.events).toEqual([
      foreign,
      otherWarehouse,
      unknown,
    ]);
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items).toHaveLength(entries.length);
  });

  it("uses the record owner when an older Moment name has no project prefix", () => {
    const owner = "warehouses/one/projects/active";
    const local = event("events/legacy", { platform: "a" });
    local.event.record = `${owner}/records/record`;
    const foreign = event("events/foreign", { platform: "a" });
    foreign.event.record = "warehouses/one/projects/other/records/record";
    const tracks = getMomentTracks([local, foreign], schema(), owner);
    expect(tracks.find((track) => track.kind === "value")?.events).toEqual([local]);
    expect(tracks.find((track) => track.kind === "ungrouped")?.events).toEqual([foreign]);
  });

  it("decodes rules from the actual protocol JSON and remains compatible with old servers", () => {
    const current = fromJson(CustomFieldSchemaSchema, {
      properties: [{ id: "platform", enums: { values: { a: "Alpha" } } }],
      groupingRules: [{ propertyId: "platform" }],
    });
    expect(getMomentTracks([event("one", { platform: "a" })], current)[0]?.title).toBe("Alpha");
    const old = fromJson(CustomFieldSchemaSchema, { properties: [] });
    expect(getMomentTracks([event("one")], old)[0]?.kind).toBe("ungrouped");
  });

  it("keeps rule order, skips deleted/non-single-select/duplicate fields and limits depth to five", () => {
    const current = schema(["a", "b", "c", "d", "e", "f"]);
    current.properties.push(
      create(PropertySchema, { id: "text", type: { case: "text", value: {} } }),
    );
    current.properties.push(
      create(PropertySchema, { id: "multi", type: { case: "enums", value: { multiple: true } } }),
    );
    current.groupingRules = ["deleted", "multi", "text", "b", "b", "a", "c", "d", "e", "f"].map(
      (propertyId) => ({
        $typeName: "coscene.dataplatform.v1alpha3.common.CustomFieldGroupingRule",
        propertyId,
      }),
    );
    expect(getGroupingProperties(current).map((entry) => entry.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
      "e",
    ]);
  });

  it("sorts by a fixed name order with ID ties, then unknown values, then missing", () => {
    const current = schema();
    current.properties = [
      property("platform", { z: "Same", a: "Same", lower: "alpha", upper: "Alpha" }),
    ];
    const entries = [
      event("missing"),
      event("z", { platform: "z" }),
      event("unknown", { platform: "removed" }),
      event("a", { platform: "a" }),
      event("lower", { platform: "lower" }),
      event("upper", { platform: "upper" }),
    ];
    expect(getMomentTracks(entries, current).map((track) => track.events[0]?.event.name)).toEqual([
      "upper",
      "a",
      "z",
      "lower",
      "unknown",
      "missing",
    ]);
    expect(getMomentTracks([...entries].reverse(), current).map((track) => track.id)).toEqual(
      getMomentTracks(entries, current).map((track) => track.id),
    );
  });

  it("retains group identity across field/option renames and option deletion", () => {
    const current = schema();
    const entries = [event("one", { platform: "a" })];
    const before = getMomentTracks(entries, current)[0]!;
    current.properties[0]!.name = "New field name";
    if (current.properties[0]!.type.case === "enums") {
      current.properties[0]!.type.value.values.a = "Renamed";
    }
    const renamed = getMomentTracks(entries, current)[0]!;
    expect(renamed.id).toBe(before.id);
    expect(renamed.title).toBe("Renamed");
    if (current.properties[0]!.type.case === "enums") {
      delete current.properties[0]!.type.value.values.a;
    }
    const deleted = getMomentTracks(entries, current)[0]!;
    expect(deleted.id).toBe(before.id);
    expect(deleted.kind).toBe("unknown");
    expect(deleted.events).toEqual(entries);
  });

  it("skips missing intermediate fields and keeps the full occupied field/option path", () => {
    const current = schema(["a", "b", "c", "d", "e"]);
    current.properties = current.properties.map((entry) =>
      property(
        entry.id,
        Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i), String(i)])),
      ),
    );
    const entries = [
      event("one", { a: "1", c: "2", e: "3" }),
      event("two", { a: "4", c: "2", e: "3" }),
    ];
    const tracks = getMomentTracks(entries, current);
    const layout = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(layout.rows).toHaveLength(6);
    expect(layout.rows.map((row) => row.track.depth)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(layout.rows.map((row) => row.track.fieldName)).toEqual(["a", "c", "e", "a", "c", "e"]);
    expect(layout.items.map((item) => item.event.event.name).sort()).toEqual(["one", "two"]);
    expect(new Set(allTracks(tracks).map((track) => track.id)).size).toBe(6);
  });

  it("places all eight optional-field combinations at their last filled field or the root", () => {
    const entries = [
      event("none"),
      event("a", { a: "a" }),
      event("b", { b: "a" }),
      event("c", { c: "a" }),
      event("ab", { a: "a", b: "a" }),
      event("ac", { a: "a", c: "a" }),
      event("bc", { b: "a", c: "a" }),
      event("abc", { a: "a", b: "a", c: "a" }),
    ];
    const tracks = getMomentTracks(entries, schema(["a", "b", "c"]));
    const flat = allTracks(tracks);
    expect(flat).toHaveLength(8);
    expect(flat.flatMap((track) => track.events)).toHaveLength(entries.length);
    for (const entry of entries) {
      const track = flat.find((candidate) => candidate.events.includes(entry))!;
      expect(track.events).toEqual([entry]);
      const fields = entry.event.customFieldValues.map((value) => value.property!.id);
      expect(track.depth).toBe(Math.max(0, fields.length - 1));
      expect(track.fieldName).toBe(fields.at(-1) ?? "");
      if (fields.length > 0) {
        expect(JSON.parse(track.id)[1].map(([id]: string[]) => id)).toEqual(fields);
      }
    }
    const rootA = tracks.find((track) => track.fieldName === "a")!;
    expect(rootA.events.map((entry) => entry.event.name)).toEqual(["a"]);
    expect(rootA.count).toBe(4);
    expect(rootA.children.map((track) => track.fieldName)).toEqual(["b", "c"]);
    expect(rootA.children[0]?.events.map((entry) => entry.event.name)).toEqual(["ab"]);
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items).toHaveLength(entries.length);
  });

  it("keeps absent, unset and empty enum values on one root track without a five-level chain", () => {
    const entries = [event("absent"), event("unset"), event("empty")];
    entries[1]!.event.customFieldValues = [
      create(CustomFieldValueSchema, { property: { id: "a" } }),
    ];
    entries[2]!.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: { id: "b" },
        value: { case: "enums", value: { id: "", ids: [] } },
      }),
    ];
    const tracks = getMomentTracks(entries, schema(["a", "b", "c", "d", "e"]));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      depth: 0,
      fieldName: "",
      count: 3,
      children: [],
      events: entries,
    });
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items).toHaveLength(3);
  });

  it("preserves values stored via legacy ids and invalid or multi-value historical data", () => {
    const entries = [event("legacy"), event("multi"), event("invalid"), event("missing")];
    entries[0]!.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: { id: "platform" },
        value: { case: "enums", value: { ids: ["a"] } },
      }),
    ];
    entries[1]!.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: { id: "platform" },
        value: { case: "enums", value: { ids: ["b", "a"] } },
      }),
    ];
    entries[2]!.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: { id: "platform" },
        value: { case: "text", value: { value: "historical" } },
      }),
    ];
    const tracks = getMomentTracks(entries, schema());
    expect(tracks.map((track) => track.kind)).toEqual(["value", "unknown", "unknown", "missing"]);
    expect(
      allTracks(tracks)
        .flatMap((track) => track.events)
        .map((entry) => entry.event.name)
        .sort(),
    ).toEqual(entries.map((entry) => entry.event.name).sort());
  });

  it("lays out parent Moments with child tracks, including overlap previews and subtree collapse", () => {
    const entries = [
      event("parent-one", { a: "a" }),
      event("parent-two", { a: "a" }),
      event("child", { a: "a", b: "a" }),
      event("grandchild", { a: "a", b: "a", c: "a" }),
      event("sibling", { a: "b" }),
    ];
    entries[1]!.secondsSinceStart = 100;
    const tracks = getMomentTracks(entries, schema(["a", "b", "c"]));
    const before = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(before.rows.map((row) => [row.lane, row.laneCount])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(before.items.map((item) => item.event.event.name).sort()).toEqual(
      entries.map((entry) => entry.event.name).sort(),
    );
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items[0]).toBe(before.items[0]);
    const preview = layoutMomentTracks({
      tracks,
      viewport,
      view: {},
      overrides: new Map([["parent-two", { ...entries[1]!, secondsSinceStart: 0 }]]),
    });
    expect(preview.rows.map((row) => [row.lane, row.laneCount])).toEqual([
      [0, 2],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    expect(preview.items.find((item) => item.event.event.name === "child")?.lane).toBe(2);
    expect(preview.items.find((item) => item.event.event.name === "grandchild")?.lane).toBe(3);
    expect(entries[1]!.secondsSinceStart).toBe(100);
    const collapsed = layoutMomentTracks({
      tracks,
      viewport,
      view: { collapsed: { [tracks[0]!.id]: true } },
    });
    expect(collapsed.rows).toHaveLength(2);
    expect(collapsed.items.map((item) => item.event.event.name)).toEqual(["sibling"]);
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items).toHaveLength(5);
  });

  it("keeps overlapping leaf Moments visible despite saved collapse flags", () => {
    const entries = [
      event("one", { platform: "a" }),
      event("two", { platform: "a" }),
      event("three", { platform: "b" }),
    ];
    const tracks = getMomentTracks(entries, schema());
    const full = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(full.rows.map((row) => row.laneCount)).toEqual([2, 1]);
    expect(full.items.find((item) => item.event.event.name === "three")?.lane).toBe(2);
    const collapsed = layoutMomentTracks({
      tracks,
      viewport,
      view: { collapsed: { [tracks[0]!.id]: true } },
    });
    expect(collapsed.rows.map((row) => row.collapsed)).toEqual([false, false]);
    expect(collapsed.rows.map((row) => row.laneCount)).toEqual([2, 1]);
    expect(collapsed.items).toEqual(full.items);
    expect(entries).toHaveLength(3);
  });

  it("ignores saved parent visibility while retaining leaf visibility, counts and source data", () => {
    const entries = [
      event("parent-one", { a: "a" }),
      event("parent-two", { a: "a" }),
      event("child", { a: "a", b: "a" }),
      event("grandchild", { a: "a", b: "a", c: "a" }),
      event("sibling", { a: "b" }),
    ];
    const snapshot = structuredClone(entries);
    const tracks = getMomentTracks(entries, schema(["a", "b", "c"]));
    const parent = tracks[0]!;
    const child = parent.children[0]!;
    const leaf = child.children[0]!;
    const leafView = { hidden: { [leaf.id]: true } };
    const before = layoutMomentTracks({ tracks, viewport, view: leafView });
    const result = layoutMomentTracks({
      tracks,
      viewport,
      view: { hidden: { ...leafView.hidden, [parent.id]: true, [child.id]: true } },
    });
    expect(result).toEqual(before);
    expect(result.rows.map((row) => row.hidden)).toEqual([false, false, true, false]);
    expect(result.rows[0]!.track.count).toBe(4);
    expect(result.items.map((item) => item.event.event.name)).toEqual([
      "parent-one",
      "parent-two",
      "child",
      "sibling",
    ]);
    expect(layoutMomentTracks({ tracks, viewport, view: {} }).items).toHaveLength(5);
    expect(entries).toEqual(snapshot);
  });

  it.each([false, true])(
    "folds and unfolds a formerly hidden parent while preserving leaf visibility (%s)",
    (leafHidden) => {
      const tracks = getMomentTracks(
        [event("parent", { a: "a" }), event("child", { a: "a", b: "a" })],
        schema(["a", "b"]),
      );
      const id = tracks[0]!.id;
      const child = tracks[0]!.children[0]!;
      const view = { collapsed: { [id]: true }, hidden: { [id]: true, [child.id]: leafHidden } };
      const result = layoutMomentTracks({ tracks, viewport, view });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ collapsed: true, hidden: false, laneCount: 1 });
      expect(result.items).toHaveLength(0);
      const expanded = layoutMomentTracks({ tracks, viewport, view: { ...view, collapsed: {} } });
      expect(expanded.rows).toHaveLength(2);
      expect(expanded.rows.map((row) => row.hidden)).toEqual([false, leafHidden]);
      expect(expanded.items.map((item) => item.event.event.name)).toEqual(
        leafHidden ? ["parent"] : ["parent", "child"],
      );
    },
  );

  it.each([undefined, schema()])("hides ungrouped and unfilled leaf tracks (%s)", (current) => {
    const tracks = getMomentTracks([event("one"), event("two")], current);
    const result = layoutMomentTracks({
      tracks,
      viewport,
      view: { hidden: { [tracks[0]!.id]: true } },
    });
    expect(result.items).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ hidden: true, laneCount: 1 });
    expect(result.rows[0]!.track.count).toBe(2);
  });

  it("applies visibility only while a node is a leaf as filtering changes the tree", () => {
    const current = schema(["a", "b"]);
    const parent = event("parent", { a: "a" });
    const tracks = getMomentTracks([parent, event("child", { a: "a", b: "a" })], current);
    const view = { hidden: { [tracks[0]!.id]: true } };
    expect(layoutMomentTracks({ tracks, viewport, view }).items).toHaveLength(2);
    const filtered = getMomentTracks([parent], current);
    const result = layoutMomentTracks({ tracks: filtered, viewport, view });
    expect(result.items).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ hidden: true, collapsed: false, laneCount: 1 });
  });

  it.each([undefined, schema()])(
    "ignores saved collapse flags on the ungrouped or all-empty root (%s)",
    (current) => {
      const entries = [event("root")];
      const tracks = getMomentTracks(entries, current);
      const layout = layoutMomentTracks({
        tracks,
        viewport,
        view: { collapsed: { [tracks[0]!.id]: true } },
      });
      expect(layout.rows[0]?.collapsed).toBe(false);
      expect(layout.items.map((item) => item.event.event.name)).toEqual(["root"]);
    },
  );

  it("shows a formerly collapsed parent when its children disappear from the projection", () => {
    const current = schema(["a", "b"]);
    const entries = [event("parent", { a: "a" }), event("child", { a: "a", b: "a" })];
    const tracks = getMomentTracks(entries, current);
    const view = { collapsed: { [tracks[0]!.id]: true } };
    expect(layoutMomentTracks({ tracks, viewport, view }).items).toHaveLength(0);
    const filtered = getMomentTracks([entries[0]!], current);
    expect(filtered[0]?.id).toBe(tracks[0]!.id);
    expect(
      layoutMomentTracks({ tracks: filtered, viewport, view }).items.map(
        (item) => item.event.event.name,
      ),
    ).toEqual(["parent"]);
  });

  it("shares unaffected leaf items during a drag and shifts later labels with preview lanes", () => {
    const entries = [
      event("one", { platform: "a" }),
      event("two", { platform: "a" }),
      event("three", { platform: "b" }),
    ];
    entries[1]!.secondsSinceStart = 10;
    const tracks = getMomentTracks(entries, schema());
    const before = layoutMomentTracks({ tracks, viewport, view: {} });
    const unchanged = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(unchanged.items[0]).toBe(before.items[0]);
    const after = layoutMomentTracks({
      tracks,
      viewport,
      view: {},
      overrides: new Map([["two", { ...entries[1]!, secondsSinceStart: 0 }]]),
    });
    expect(after.rows[0]?.laneCount).toBe(2);
    expect(after.rows[1]?.lane).toBe(2);
    expect(after.items.find((item) => item.event.event.name === "three")?.lane).toBe(2);
    expect(entries[1]!.secondsSinceStart).toBe(10);
  });

  it("retains zero-duration Moments at both file boundaries", () => {
    const entries = [event("start", { platform: "a" }), event("end", { platform: "b" })];
    entries.forEach((entry, i) => {
      entry.secondsSinceStart = i * 3600;
      entry.endTime = entry.startTime;
    });
    expect(
      layoutMomentTracks({
        tracks: getMomentTracks(entries, schema()),
        viewport,
        view: {},
      }).items.map((item) => item.event.event.name),
    ).toEqual(["start", "end"]);
  });
});

describe("project Moment field tracks", () => {
  function trackSchema() {
    return create(CustomFieldSchemaSchema, {
      properties: [
        property("group"),
        create(PropertySchema, { id: "notes", name: "Notes", type: { case: "text", value: {} } }),
        create(PropertySchema, { id: "score", name: "Score", type: { case: "number", value: {} } }),
        property("tags", { a: "Alpha", b: "Beta" }),
      ],
      groupingRules: [{ propertyId: "group" }],
      trackRules: ["tags", "score", "notes"].map((propertyId) => ({ propertyId })),
    });
  }

  function withFields(name: string, group?: string): TimelinePositionedEvent {
    const entry = event(name, group == undefined ? {} : { group });
    entry.event.customFieldValues.push(
      create(CustomFieldValueSchema, {
        property: { id: "notes" },
        value: { case: "text", value: { value: "Pick up cup" } },
      }),
      create(CustomFieldValueSchema, {
        property: { id: "score" },
        value: { case: "number", value: { value: 0 } },
      }),
      create(CustomFieldValueSchema, {
        property: { id: "tags" },
        value: { case: "enums", value: { ids: ["b", "a"] } },
      }),
    );
    return entry;
  }

  it("filters conflicting/deleted/duplicate/untyped rules and sorts field names with ID ties", () => {
    const current = trackSchema();
    current.properties.push(
      create(PropertySchema, { id: "notes-two", name: "Notes", type: { case: "text", value: {} } }),
      create(PropertySchema, { id: "untyped", name: "Untyped" }),
    );
    current.trackRules = [
      "tags",
      "notes-two",
      "notes",
      "notes",
      "group",
      "deleted",
      "untyped",
      "score",
    ].map((propertyId) => ({
      $typeName: "coscene.dataplatform.v1alpha3.common.CustomFieldTrackRule",
      propertyId,
    }));
    expect(getTrackProperties(current).map((field) => field.id)).toEqual([
      "notes",
      "notes-two",
      "score",
      "tags",
    ]);
    current.groupingRules = [
      {
        $typeName: "coscene.dataplatform.v1alpha3.common.CustomFieldGroupingRule",
        propertyId: "notes",
      },
    ];
    expect(getTrackProperties(current).map((field) => field.id)).not.toContain("notes");
  });

  it("preserves group identities, source values and counts while projecting all selected fields", () => {
    const current = trackSchema();
    const entries = [withFields("one", "a"), withFields("two", "a")];
    const before = structuredClone(entries);
    const base = getMomentTracks(entries, { ...current, trackRules: [] });
    const tracks = getMomentTracks(entries, current);
    expect(tracks[0]?.id).toBe(base[0]?.id);
    expect(tracks[0]?.count).toBe(2);
    expect(tracks[0]?.events).toEqual(entries);
    expect(tracks[0]?.children.map((track) => track.title)).toEqual(["Notes", "Score", "tags"]);
    const layout = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(layout.items).toHaveLength(8);
    expect(new Set(layout.items.map((item) => item.renderId)).size).toBe(8);
    expect(
      layout.items.filter((item) => item.fieldPropertyId === "score").map((item) => item.label),
    ).toEqual(["0", "0"]);
    expect(
      layout.items.filter((item) => item.fieldPropertyId === "tags").map((item) => item.label),
    ).toEqual(["Beta, Alpha", "Beta, Alpha"]);
    expect(layout.items.every((item) => entries.includes(item.event))).toBe(true);
    expect(entries).toEqual(before);
    const renamed = trackSchema();
    renamed.properties.find((field) => field.id === "notes")!.name = "Renamed";
    expect(
      allTracks(getMomentTracks(entries, renamed)).find(
        (track) => track.fieldPropertyId === "notes",
      )?.id,
    ).toBe(tracks[0]?.children[0]?.id);
  });

  it("projects directly attached parent Moments separately from deeper groups", () => {
    const current = trackSchema();
    current.properties.push(property("subgroup"));
    current.groupingRules.push({
      $typeName: "coscene.dataplatform.v1alpha3.common.CustomFieldGroupingRule",
      propertyId: "subgroup",
    });
    current.trackRules = current.trackRules.filter((rule) => rule.propertyId === "notes");
    const parent = withFields("parent", "a");
    const child = withFields("child", "a");
    child.event.customFieldValues.push(
      create(CustomFieldValueSchema, {
        property: { id: "subgroup" },
        value: { case: "enums", value: { id: "b" } },
      }),
    );
    const tracks = getMomentTracks([parent, child], current);
    expect(tracks[0]?.count).toBe(2);
    expect(tracks[0]?.children.map((track) => [track.kind, track.count])).toEqual([
      ["field", 1],
      ["value", 1],
    ]);
    const layout = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(layout.rows.map((row) => row.track.kind)).toEqual(["value", "field", "value", "field"]);
    expect(layout.items.map((item) => item.event.event.name)).toEqual([
      "parent",
      "parent",
      "child",
      "child",
    ]);
    expect(canHideMomentTrack(tracks[0]!)).toBe(false);
    const collapsed = layoutMomentTracks({
      tracks,
      viewport,
      view: { collapsed: { [tracks[0]!.id]: true } },
    });
    expect(collapsed.rows).toHaveLength(1);
    expect(collapsed.items).toHaveLength(0);
  });

  it("keeps base and field visibility independent and collapses an entire projected group", () => {
    const entries = [withFields("one", "a")];
    const tracks = getMomentTracks(entries, trackSchema());
    const base = tracks[0]!;
    expect(canHideMomentTrack(base)).toBe(true);
    const hideBase = layoutMomentTracks({
      tracks,
      viewport,
      view: { hidden: { [base.id]: true } },
    });
    expect(hideBase.items).toHaveLength(3);
    expect(hideBase.items.every((item) => item.fieldPropertyId != undefined)).toBe(true);
    const hideField = layoutMomentTracks({
      tracks,
      viewport,
      view: { hidden: { [base.children[0]!.id]: true } },
    });
    expect(hideField.items).toHaveLength(3);
    expect(hideField.items.some((item) => item.fieldPropertyId === "notes")).toBe(false);
    expect(hideField.items.some((item) => item.fieldPropertyId == undefined)).toBe(true);
    expect(
      layoutMomentTracks({ tracks, viewport, view: { collapsed: { [base.id]: true } } }).items,
    ).toHaveLength(0);
  });

  it("does not project foreign project fields even when there are no grouping rules", () => {
    const owner = "warehouses/one/projects/active";
    const local = withFields(`${owner}/events/local`, "a");
    const foreign = withFields("warehouses/one/projects/foreign/events/foreign", "a");
    foreign.event.record = `${owner}/records/conflicting-record`;
    const current = trackSchema();
    for (const grouped of [false, true]) {
      const tracks = getMomentTracks(
        [local, foreign],
        { ...current, groupingRules: grouped ? current.groupingRules : [] },
        owner,
      );
      const layout = layoutMomentTracks({ tracks, viewport, view: {} });
      expect(
        layout.items.filter((item) => item.fieldPropertyId != undefined).map((item) => item.event),
      ).toEqual([local, local, local]);
      expect(layout.items.filter((item) => item.fieldPropertyId == undefined)).toHaveLength(2);
    }
  });

  it("skips absent, empty and schema-mismatched values without dropping the base Moment", () => {
    const current = trackSchema();
    const empty = event("empty", { group: "a" });
    empty.event.customFieldValues.push(
      create(CustomFieldValueSchema, {
        property: { id: "notes" },
        value: { case: "text", value: { value: " " } },
      }),
      create(CustomFieldValueSchema, {
        property: { id: "score" },
        value: { case: "text", value: { value: "legacy" } },
      }),
      create(CustomFieldValueSchema, {
        property: { id: "tags" },
        value: { case: "enums", value: {} },
      }),
    );
    const tracks = getMomentTracks([empty], current);
    expect(tracks[0]?.children).toEqual([]);
    expect(
      layoutMomentTracks({ tracks, viewport, view: {} }).items.map((item) => item.event),
    ).toEqual([empty]);
  });

  it("supports more than five field tracks with shared source overrides and stable cached items", () => {
    const current = create(CustomFieldSchemaSchema, {
      properties: Array.from({ length: 7 }, (_, i) =>
        create(PropertySchema, {
          id: String(i),
          name: `Field ${i}`,
          type: { case: "text", value: {} },
        }),
      ),
      trackRules: Array.from({ length: 7 }, (_, i) => ({ propertyId: String(i) })),
    });
    const entry = event("one");
    entry.event.customFieldValues = current.properties.map((field) =>
      create(CustomFieldValueSchema, {
        property: { id: field.id },
        value: { case: "text", value: { value: field.name } },
      }),
    );
    const tracks = getMomentTracks([entry], current);
    expect(tracks[0]?.children).toHaveLength(7);
    const before = layoutMomentTracks({ tracks, viewport, view: {} });
    const repeated = layoutMomentTracks({ tracks, viewport, view: {} });
    expect(repeated.items.every((item, i) => item === before.items[i])).toBe(true);
    const override = { ...entry, secondsSinceStart: 10 };
    const preview = layoutMomentTracks({
      tracks,
      viewport,
      view: {},
      overrides: new Map([[entry.event.name, override]]),
    });
    expect(preview.items).toHaveLength(8);
    expect(preview.items.every((item) => item.event === override && item.startSec === 10)).toBe(
      true,
    );
    expect(preview.items.map((item) => item.renderId)).toEqual(
      before.items.map((item) => item.renderId),
    );
    expect(entry.secondsSinceStart).toBe(0);
  });
});
