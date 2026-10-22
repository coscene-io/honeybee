// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromJson } from "@bufbuild/protobuf";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { getContrastRatio } from "@mui/material/styles";

import { getMomentFieldColor } from "./momentTimelineColors";

const field = (value: Record<string, unknown>) =>
  fromJson(CustomFieldValueSchema, { property: { id: "action" }, ...value });

it("colors multi-select combinations independently of order, duplicates and legacy single IDs", () => {
  const ab = getMomentFieldColor(field({ enums: { ids: ["a", "b"] } }));
  expect(getMomentFieldColor(field({ enums: { id: "b", ids: ["b", "", "a", "a"] } }))).toBe(ab);
  expect(getMomentFieldColor(field({ enums: { id: "a" } }))).toBe(
    getMomentFieldColor(field({ enums: { ids: ["a"] } })),
  );
  expect(getMomentFieldColor(field({ enums: { id: "a" } }))).not.toBe(ab);
});

it("normalizes user identities and treats multiple users as an unordered combination", () => {
  expect(getMomentFieldColor(field({ user: { ids: ["users/amy", "lee"] } }))).toBe(
    getMomentFieldColor(field({ user: { ids: ["users/lee", "amy", "users/amy", ""] } })),
  );
  expect(getMomentFieldColor(field({ user: { ids: ["amy"] } }))).not.toBe(
    getMomentFieldColor(field({ user: { ids: ["amy", "lee"] } })),
  );
});

it("uses field and project identities rather than display names", () => {
  const original = field({ text: { value: "Walk" } });
  const color = getMomentFieldColor(original, "projects/one");
  original.property!.name = "Renamed";
  expect(getMomentFieldColor(original, "projects/one")).toBe(color);
  expect(getMomentFieldColor(original, "projects/two")).not.toBe(color);
  original.property!.id = "other";
  expect(getMomentFieldColor(original, "projects/one")).not.toBe(color);
});

it("distinguishes raw types, text, zero and timestamps within the same displayed second", () => {
  const values = [
    field({ text: { value: "0" } }),
    field({ text: { value: "Walk" } }),
    field({ number: { value: 0 } }),
    field({ number: { value: 1 } }),
    field({ time: { value: "2026-10-22T08:00:00.000000001Z" } }),
    field({ time: { value: "2026-10-22T08:00:00.000000002Z" } }),
  ];
  expect(new Set(values.map((value) => getMomentFieldColor(value))).size).toBe(values.length);
});

it("keeps a large set of field colors distinct and readable with dark text", () => {
  const colors = Array.from({ length: 1000 }, (_, value) =>
    getMomentFieldColor(field({ number: { value } })),
  );
  expect(new Set(colors).size).toBe(colors.length);
  expect(colors.every((color) => getContrastRatio(color, "#000") >= 4.5)).toBe(true);
});
