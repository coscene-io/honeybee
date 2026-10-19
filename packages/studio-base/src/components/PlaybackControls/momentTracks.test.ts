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
function leaves(tracks: MomentTrack[]): MomentTrack[] {
  return tracks.flatMap((track) =>
    track.children.length === 0 ? [track] : leaves(track.children),
  );
}

describe("project Moment grouping", () => {
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

  it("uses the full path and preserves missing intermediate levels without empty Cartesian groups", () => {
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
    expect(layout.rows).toHaveLength(10);
    expect(layout.items.map((item) => item.event.event.name).sort()).toEqual(["one", "two"]);
    expect(new Set(leaves(tracks).map((track) => track.id)).size).toBe(2);
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
      leaves(tracks)
        .flatMap((track) => track.events)
        .map((entry) => entry.event.name)
        .sort(),
    ).toEqual(entries.map((entry) => entry.event.name).sort());
  });

  it("splits overlapping Moments within each leaf and collapses an entire subtree", () => {
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
    expect(collapsed.rows.map((row) => row.laneCount)).toEqual([1, 1]);
    expect(collapsed.items.map((item) => item.event.event.name)).toEqual(["three"]);
    expect(entries).toHaveLength(3);
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
