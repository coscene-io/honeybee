// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  CustomFieldValueSchema,
  PropertySchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { formatMomentFieldValue } from "./momentFieldValues";

describe("Moment field projection values", () => {
  it("keeps text and zero while skipping unfilled values and changed field types", () => {
    const text = create(PropertySchema, { type: { case: "text", value: {} } });
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, {
          value: { case: "text", value: { value: "<b>Read as text</b>" } },
        }),
        text,
      ),
    ).toBe("<b>Read as text</b>");
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "text", value: { value: "  \n" } } }),
        text,
      ),
    ).toBeUndefined();
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "number", value: { value: 0 } } }),
        create(PropertySchema, { type: { case: "number", value: {} } }),
      ),
    ).toBe("0");
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "number", value: { value: 1 } } }),
        create(PropertySchema, { type: { case: "text", value: {} } }),
      ),
    ).toBeUndefined();
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema),
        create(PropertySchema, { type: { case: "text", value: {} } }),
      ),
    ).toBeUndefined();
  });

  it("combines multi-values once and retains IDs removed from the current enum schema", () => {
    const field = create(CustomFieldValueSchema, {
      value: { case: "enums", value: { id: "a", ids: ["a", "deleted", "b", ""] } },
    });
    const property = create(PropertySchema, {
      type: { case: "enums", value: { multiple: true, values: { a: "Alpha", b: "Beta" } } },
    });
    expect(formatMomentFieldValue(field, property)).toBe("Alpha, deleted, Beta");
    expect(field.value).toMatchObject({ value: { id: "a", ids: ["a", "deleted", "b", ""] } });
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "enums", value: {} } }),
        property,
      ),
    ).toBeUndefined();
  });

  it("uses one batch-loaded name map while retaining unknown historical user IDs", () => {
    const field = create(CustomFieldValueSchema, {
      value: { case: "user", value: { ids: ["one", "users/two", "deleted", "one", ""] } },
    });
    const property = create(PropertySchema, { type: { case: "user", value: {} } });
    expect(
      formatMomentFieldValue(field, property, {
        userNames: new Map([
          ["users/one", "Alice"],
          ["two", "Bob"],
        ]),
      }),
    ).toBe("Alice, Bob, deleted");
    expect(formatMomentFieldValue(field, property)).toBe("one, users/two, deleted");
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "user", value: { ids: [""] } } }),
        property,
      ),
    ).toBeUndefined();
  });

  it("formats an absolute timestamp through the caller and skips an unset timestamp", () => {
    const stamp = timestampFromDate(new Date("2026-10-21T00:00:00Z"));
    const field = create(CustomFieldValueSchema, {
      value: { case: "time", value: { value: stamp } },
    });
    const property = create(PropertySchema, { type: { case: "time", value: {} } });
    const formatter = jest.fn(() => "2026-10-21 08:00:00");
    expect(formatMomentFieldValue(field, property, { formatTime: formatter })).toBe(
      "2026-10-21 08:00:00",
    );
    expect(formatter).toHaveBeenCalledWith(stamp);
    expect(
      formatMomentFieldValue(
        create(CustomFieldValueSchema, { value: { case: "time", value: {} } }),
        property,
      ),
    ).toBeUndefined();
  });
});
