// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import cloneDeep from "lodash-es/cloneDeep";

import type { MomentCreationScope } from "@foxglove/studio-base/context/EventsContext";

// An initially unresolved endpoint/profile must not invalidate the same page's
// snapshot when it finishes loading. API client identity is deliberately excluded.
export function isSameMomentCreationScope(
  previous: MomentCreationScope,
  current: MomentCreationScope,
): boolean {
  return (
    previous.projectName === current.projectName &&
    (previous.baseUrl == undefined ||
      current.baseUrl == undefined ||
      previous.baseUrl === current.baseUrl) &&
    (previous.userId == undefined ||
      current.userId == undefined ||
      previous.userId === current.userId)
  );
}

/** Rebuild values with current definitions, preserving protobuf timestamps and numeric zero. */
export function restoreMomentCustomFieldValues(
  properties: Property[],
  values: CustomFieldValue[],
): Record<string, CustomFieldValue> {
  const previousValues = new Map(values.map((value) => [value.property?.id, value]));
  const result: Record<string, CustomFieldValue> = {};

  for (const property of properties) {
    const previous = previousValues.get(property.id);
    if (
      previous == undefined ||
      previous.value.case !== property.type.case ||
      previous.value.case == undefined
    ) {
      continue;
    }
    const value = cloneDeep(previous);
    value.property = cloneDeep(property);

    if (property.type.case === "enums" && value.value.case === "enums") {
      if (
        previous.property?.type.case !== "enums" ||
        previous.property.type.value.multiple !== property.type.value.multiple
      ) {
        continue;
      }
      if (property.type.value.multiple) {
        const options = property.type.value.values;
        value.value.value.ids = [...new Set(value.value.value.ids)].filter((id) =>
          Object.hasOwn(options, id),
        );
        if (value.value.value.ids.length === 0) {
          continue;
        }
      } else if (!Object.hasOwn(property.type.value.values, value.value.value.id)) {
        continue;
      }
    }

    if (property.type.case === "user" && value.value.case === "user") {
      if (
        previous.property?.type.case !== "user" ||
        previous.property.type.value.multiple !== property.type.value.multiple
      ) {
        continue;
      }
      if (value.value.value.ids.length === 0) {
        continue;
      }
    }

    result[property.id] = value;
  }
  return result;
}
