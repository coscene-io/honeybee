// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

export function convertCustomFieldValuesToMap(
  customFieldValues?: CustomFieldValue[],
): Record<string, CustomFieldValue> {
  const customFieldValuesMap: Record<string, CustomFieldValue> = {};
  customFieldValues?.forEach((customFieldValue) => {
    if (customFieldValue.property?.id) {
      customFieldValuesMap[customFieldValue.property.id] = customFieldValue;
    }
  });

  return customFieldValuesMap;
}

export function convertCustomFieldValuesMapToArray(
  customFieldValuesMap: Record<string, CustomFieldValue | undefined>,
): CustomFieldValue[] {
  return Object.entries(customFieldValuesMap)
    .map(([, value]) => value)
    .filter((item): item is CustomFieldValue => item?.value.value != undefined);
}
