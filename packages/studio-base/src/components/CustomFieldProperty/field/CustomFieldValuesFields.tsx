// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import _debounce from "lodash/debounce";
import { useMemo } from "react";

import { CustomFieldValueField } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValueField";

import { CustomFieldValuesFindByPropery } from "./CustomFieldValuesFindByPropery";

export function CustomFieldValuesFields({
  properties,
  customFieldValues,
  readonly = false,
  onChange,
  variant = "primary",
  ignoreProperties = false,
}: {
  properties: Property[];
  customFieldValues: CustomFieldValue[];
  readonly?: boolean;
  onChange?: (customFieldValues: CustomFieldValue[]) => void;
  variant?: "primary" | "secondary";
  ignoreProperties?: boolean;
}): React.ReactNode {
  const debouncedOnChange = useMemo(
    () =>
      onChange
        ? _debounce((values: CustomFieldValue[]) => {
            onChange(values);
          }, 300)
        : undefined,
    [onChange],
  );

  if (ignoreProperties) {
    return customFieldValues.map((customFieldValue, index) => (
      <CustomFieldValueField
        key={customFieldValue.property?.id ?? index}
        variant={variant}
        customFieldValue={customFieldValue}
        readonly={readonly}
        onChange={
          debouncedOnChange
            ? (newCustomFieldValue) => {
                const index = customFieldValues.findIndex(
                  (value) => value.property?.id === newCustomFieldValue.property?.id,
                );
                if (index !== -1) {
                  const newCustomFieldValues = [...customFieldValues];
                  newCustomFieldValues[index] = newCustomFieldValue;
                  debouncedOnChange(newCustomFieldValues);
                } else {
                  debouncedOnChange([...customFieldValues, newCustomFieldValue]);
                }
              }
            : undefined
        }
      />
    ));
  }

  return (
    <>
      {properties.map((property) => {
        return (
          <CustomFieldValuesFindByPropery
            key={property.id}
            property={property}
            customFieldValues={customFieldValues}
            readonly={readonly}
            onChange={debouncedOnChange}
            variant={variant}
          />
        );
      })}
    </>
  );
}
