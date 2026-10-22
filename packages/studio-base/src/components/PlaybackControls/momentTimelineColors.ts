// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

/** Mix nearby IDs/values across the color space without a repeating fixed palette. */
function colorHash(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Use raw identities, so renames, localization and multi-value order cannot change a color. */
export function getMomentFieldColor(field: CustomFieldValue, projectName?: string): string {
  let value: unknown;
  switch (field.value.case) {
    case "enums":
      value = [...new Set([field.value.value.id, ...field.value.value.ids].filter(Boolean))].sort();
      break;
    case "user":
      value = [
        ...new Set(field.value.value.ids.filter(Boolean).map((id) => id.replace(/^users\//, ""))),
      ].sort();
      break;
    case "time":
      value = [field.value.value.value?.seconds.toString(), field.value.value.value?.nanos];
      break;
    case "text":
    case "number":
      value = field.value.value.value;
      break;
    case undefined:
      break;
  }
  const hash = colorHash(
    JSON.stringify([projectName, field.property?.id, field.value.case, value])!,
  );
  const hue = ((hash / 2 ** 32) * 360).toFixed(6);
  const saturation = 55 + ((hash >>> 8) % 21);
  const lightness = 74 + ((hash >>> 16) % 9);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
