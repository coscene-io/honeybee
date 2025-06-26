// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Property } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { CustomFieldValueField } from "./CustomFieldValueField";

export function CustomFieldValuesFindByPropery({
  property,
  customFieldValues,
  readonly = false,
  onChange,
  variant = "primary",
}: {
  property: Property;
  customFieldValues: CustomFieldValue[];
  readonly?: boolean;
  onChange?: (customFieldValues: CustomFieldValue[]) => void;
  variant?: "primary" | "secondary";
}): React.ReactNode {
  const customFieldValue =
    customFieldValues.find((value) => value.property?.id === property.id) ??
    new CustomFieldValue({ property });

  return (
    <CustomFieldValueField
      variant={variant}
      customFieldValue={customFieldValue}
      readonly={readonly}
      onChange={
        onChange
          ? (customFieldValue) => {
              const index = customFieldValues.findIndex(
                (value) => value.property?.id === property.id,
              );
              if (index !== -1) {
                const newCustomFieldValues = [...customFieldValues];
                newCustomFieldValues[index] = customFieldValue;
                onChange(newCustomFieldValues);
              } else {
                onChange([...customFieldValues, customFieldValue]);
              }
            }
          : undefined
      }
    />
  );
}
