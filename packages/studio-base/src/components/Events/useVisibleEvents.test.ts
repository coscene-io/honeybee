// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { matchesMomentField } from "./useVisibleEvents";

type FieldValue = NonNullable<MessageInitShape<typeof CustomFieldValueSchema>["value"]>;

function matches(actual: FieldValue, expected: FieldValue): boolean {
  return matchesMomentField(
    create(CustomFieldValueSchema, { value: actual }).value,
    create(CustomFieldValueSchema, { value: expected }).value,
  );
}

describe("matchesMomentField", () => {
  it("matches numbers exactly, including zero, and rejects historical values of another type", () => {
    const zero = { case: "number", value: { value: 0 } } as const;
    expect(matches(zero, zero)).toBe(true);
    expect(matches({ case: "number", value: { value: 0.01 } }, zero)).toBe(false);
    expect(matches({ case: "text", value: { value: "0" } }, zero)).toBe(false);
  });

  it("matches a selected enum ID in both single and multiple stored selections", () => {
    const chosen = { case: "enums", value: { ids: ["warning", "critical"] } } as const;
    expect(
      matches(
        { case: "enums", value: { id: "critical" } },
        {
          case: chosen.case,
          value: { ids: [...chosen.value.ids] },
        },
      ),
    ).toBe(true);
    expect(
      matches(
        { case: "enums", value: { ids: ["info", "warning"] } },
        {
          case: chosen.case,
          value: { ids: [...chosen.value.ids] },
        },
      ),
    ).toBe(true);
    expect(
      matches(
        { case: "enums", value: { id: "info" } },
        {
          case: chosen.case,
          value: { ids: [...chosen.value.ids] },
        },
      ),
    ).toBe(false);
  });

  it("normalizes stored user names to bare IDs", () => {
    expect(
      matches(
        { case: "user", value: { ids: ["users/one", "two"] } },
        { case: "user", value: { ids: ["one"] } },
      ),
    ).toBe(true);
  });

  it("matches time values in the same minute at the picker's precision", () => {
    const selected = { case: "time", value: { value: { seconds: BigInt(120) } } } as const;
    expect(matches({ case: "time", value: { value: { seconds: BigInt(179) } } }, selected)).toBe(
      true,
    );
    expect(matches({ case: "time", value: { value: { seconds: BigInt(180) } } }, selected)).toBe(
      false,
    );
  });
});
