// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import {
  CustomFieldValueSchema,
  PropertySchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { restoreMomentCustomFieldValues } from "./customFieldDefaults";

const values = [
  create(CustomFieldValueSchema, {
    property: { id: "text", type: { case: "text", value: {} } },
    value: { case: "text", value: { value: "first line\n第二行" } },
  }),
  create(CustomFieldValueSchema, {
    property: { id: "number", type: { case: "number", value: {} } },
    value: { case: "number", value: { value: 0 } },
  }),
  create(CustomFieldValueSchema, {
    property: { id: "time", type: { case: "time", value: {} } },
    value: { case: "time", value: { value: { seconds: 1785401051n, nanos: 363000001 } } },
  }),
  ...[false, true].map((multiple) =>
    create(CustomFieldValueSchema, {
      property: {
        id: `enums-${String(multiple)}`,
        type: { case: "enums", value: { multiple, values: { a: "A", b: "B" } } },
      },
      value: { case: "enums", value: multiple ? { ids: ["a", "b"] } : { id: "a" } },
    }),
  ),
  ...[false, true].map((multiple) =>
    create(CustomFieldValueSchema, {
      property: { id: `user-${String(multiple)}`, type: { case: "user", value: { multiple } } },
      value: { case: "user", value: { ids: multiple ? ["alice", "bob"] : ["alice"] } },
    }),
  ),
];
const properties = values.map((value) => value.property!);
const activeUsers = new Set(["alice", "bob"]);

it.each(values)("restores $property.id with its complete value", (previous) => {
  const restored = restoreMomentCustomFieldValues(properties, [previous], activeUsers);
  expect(restored[previous.property!.id]).toEqual(previous);
});

it("uses current names, descriptions and required flags without sharing references", () => {
  const previous = values[0]!;
  const property = create(PropertySchema, {
    ...previous.property!,
    name: "Renamed",
    required: true,
  });
  const restored = restoreMomentCustomFieldValues([property], [previous]);
  expect(restored.text?.property).toEqual(property);
  expect(restored.text?.property).not.toBe(property);
  expect(restored.text?.value).not.toBe(previous.value);
  restored.text!.value = { case: undefined };
  expect(previous.value.case).toBe("text");
});

it("drops removed fields and changed types or selection modes", () => {
  const changed = [
    create(PropertySchema, { id: "text", type: { case: "number", value: {} } }),
    create(PropertySchema, {
      id: "enums-false",
      type: { case: "enums", value: { multiple: true } },
    }),
    create(PropertySchema, { id: "user-true", type: { case: "user", value: { multiple: false } } }),
  ];
  expect(restoreMomentCustomFieldValues(changed, values, activeUsers)).toEqual({});
});

it("filters deleted enum options and keeps remaining multi-select options", () => {
  const current = properties.map((property) =>
    property.type.case === "enums"
      ? create(PropertySchema, {
          ...property,
          type: { case: "enums", value: { ...property.type.value, values: { b: "Renamed B" } } },
        })
      : property,
  );
  const restored = restoreMomentCustomFieldValues(current, values, activeUsers);
  expect(restored["enums-false"]).toBeUndefined();
  expect(restored["enums-true"]?.value).toMatchObject({ case: "enums", value: { ids: ["b"] } });
});

it("waits for current users and filters inactive or deleted people", () => {
  expect(restoreMomentCustomFieldValues(properties, values)["user-true"]).toBeUndefined();
  const restored = restoreMomentCustomFieldValues(properties, values, new Set(["bob"]));
  expect(restored["user-false"]).toBeUndefined();
  expect(restored["user-true"]?.value).toMatchObject({ case: "user", value: { ids: ["bob"] } });
});

it("preserves an explicitly cleared snapshot", () => {
  expect(restoreMomentCustomFieldValues(properties, [])).toEqual({});
  expect(
    restoreMomentCustomFieldValues(properties, [
      create(CustomFieldValueSchema, { property: properties[0] }),
    ]),
  ).toEqual({});
});
