// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import dayjs from "dayjs";

export type MomentFieldFormatOptions = {
  userNames?: ReadonlyMap<string, string>;
  /** Custom field timestamps are absolute metadata, independent of the playback time mode. */
  formatTime?: (value: Timestamp) => string;
};

/** Format a projection without changing stored values or hiding unknown historical IDs. */
export function formatMomentFieldValue(
  field: CustomFieldValue,
  property: Property,
  options: MomentFieldFormatOptions = {},
): string | undefined {
  if (field.value.case !== property.type.case) {
    // A schema type change must not interpret a historical value as its new type.
    return undefined;
  }
  switch (field.value.case) {
    case "text": {
      const value = field.value.value.value;
      return value.trim() === "" ? undefined : value;
    }
    case "number": {
      const value = field.value.value.value;
      return Number.isFinite(value) ? String(value) : undefined;
    }
    case "enums": {
      const value = field.value.value;
      const ids = [...new Set([value.id, ...value.ids].filter((id) => id !== ""))];
      const values = property.type.case === "enums" ? property.type.value.values : {};
      return ids.length === 0
        ? undefined
        : ids
            .map((id) => (Object.hasOwn(values, id) && values[id] !== "" ? values[id] : id))
            .join(", ");
    }
    case "time": {
      const value = field.value.value.value;
      if (value == undefined) {
        return undefined;
      }
      const date = dayjs(timestampDate(value));
      return date.isValid()
        ? (options.formatTime?.(value) ?? date.format("YYYY-MM-DD HH:mm:ss"))
        : undefined;
    }
    case "user": {
      const ids = [...new Set(field.value.value.ids.filter((id) => id !== ""))];
      return ids.length === 0
        ? undefined
        : ids
            .map((id) => {
              const bareId = id.startsWith("users/") ? id.slice("users/".length) : id;
              return (
                options.userNames?.get(id) ??
                options.userNames?.get(bareId) ??
                options.userNames?.get(`users/${bareId}`) ??
                id
              );
            })
            .join(", ");
    }
    case undefined:
      return undefined;
  }
}
