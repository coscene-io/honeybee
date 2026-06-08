// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Property } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { BinaryOperator } from "@foxglove/studio-base/util/coscene";

type FilterItemType = "text" | "multiSelect";

type FilterOption = {
  content: string;
  keyword: string;
  value: string;
};

type FilterItemProps = {
  field: {
    fieldRaw: string;
    jsonPath: string[];
    operators: BinaryOperator[];
  };
  label: string;
  name: string;
  options: FilterOption[];
  type: FilterItemType;
};

function convertCustomFieldFilter(property: Property, fieldRaw: string = "custom_fields") {
  let type: FilterItemType = "text";
  let options: FilterOption[] = [];

  switch (property.type.case) {
    case "text":
      type = "text";
      break;

    case "enums":
      type = "multiSelect";
      options = Object.entries(property.type.value.values).map(([id, value]) => ({
        content: value,
        keyword: value,
        value: id,
      }));
      break;
  }

  return {
    field: {
      fieldRaw,
      jsonPath: [property.id],
      operators: type === "text" ? [BinaryOperator.EQ] : [BinaryOperator.HAS],
    },
    label: property.name,
    name: `${fieldRaw}_${property.name}`,
    options,
    type,
  } as FilterItemProps;
}

export function convertCustomFieldFilters(
  properties?: Property[],
  fieldRaw: string = "custom_fields",
): FilterItemProps[] {
  return (
    properties
      ?.filter((property) => ["text", "enums"].includes(property.type.case ?? ""))
      .map((property) => convertCustomFieldFilter(property, fieldRaw)) ?? []
  );
}
