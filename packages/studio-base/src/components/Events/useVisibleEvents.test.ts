// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CustomFieldValueSchema,
  UserValueSchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import type { MomentCustomFieldFilter } from "@foxglove/studio-base/context/EventsContext";

import { matchesMomentField } from "./useVisibleEvents";

type FieldValue = NonNullable<MessageInitShape<typeof CustomFieldValueSchema>["value"]>;

function matches(actual: FieldValue, filter: MomentCustomFieldFilter): boolean {
  return matchesMomentField(create(CustomFieldValueSchema, { value: actual }).value, filter);
}

describe("matchesMomentField", () => {
  it.each([
    ["=", true, false, false],
    ["!=", false, true, true],
    [">=", true, false, true],
    [">", false, false, true],
    ["<=", true, true, false],
    ["<", false, true, false],
  ] as const)(
    "applies the %s comparison, including zero and decimals",
    (operator, equal, lower, upper) => {
      const filter = { case: "number", operator, value: 0 } as const;
      expect(matches({ case: "number", value: { value: 0 } }, filter)).toBe(equal);
      expect(matches({ case: "number", value: { value: -0.01 } }, filter)).toBe(lower);
      expect(matches({ case: "number", value: { value: 0.01 } }, filter)).toBe(upper);
      expect(matches({ case: "number", value: { value: Number.NaN } }, filter)).toBe(false);
      expect(matches({ case: "text", value: { value: "0" } }, filter)).toBe(false);
    },
  );

  it("includes both endpoints of a numeric range", () => {
    const filter = { case: "number", operator: "between", min: -1, max: 0.5 } as const;
    for (const [value, expected] of [
      [-1.1, false],
      [-1, true],
      [0, true],
      [0.5, true],
      [0.6, false],
    ] as const) {
      expect(matches({ case: "number", value: { value } }, filter)).toBe(expected);
    }
  });

  it("matches a selected enum ID in both single and multiple stored selections", () => {
    const chosen = create(CustomFieldValueSchema, {
      value: { case: "enums", value: { ids: ["warning", "critical"] } },
    }).value;
    if (chosen.case !== "enums") {
      throw new Error("expected an enum value");
    }
    expect(matches({ case: "enums", value: { id: "critical" } }, chosen)).toBe(true);
    expect(matches({ case: "enums", value: { ids: ["info", "warning"] } }, chosen)).toBe(true);
    expect(matches({ case: "enums", value: { id: "info" } }, chosen)).toBe(false);
  });

  it("normalizes stored user names to bare IDs", () => {
    expect(
      matches(
        { case: "user", value: { ids: ["users/one", "two"] } },
        { case: "user", value: create(UserValueSchema, { ids: ["one"] }) },
      ),
    ).toBe(true);
  });

  it("includes the entire end minute and supports either date bound independently", () => {
    const at = (seconds: number) =>
      ({ case: "time", value: { value: { seconds: BigInt(seconds) } } }) as const;
    const filter = { case: "time", start: 120_000, end: 180_000 } as const;
    expect(matches(at(119), filter)).toBe(false);
    expect(matches(at(120), filter)).toBe(true);
    expect(matches(at(239), filter)).toBe(true);
    expect(matches(at(240), filter)).toBe(false);
    expect(matches(at(240), { case: "time", start: filter.start })).toBe(true);
    expect(matches(at(119), { case: "time", end: filter.end })).toBe(true);
    expect(matches({ case: "time", value: {} }, filter)).toBe(false);
  });
});
