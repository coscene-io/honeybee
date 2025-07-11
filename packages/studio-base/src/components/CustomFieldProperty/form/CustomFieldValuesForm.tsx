// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Property } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import _cloneDeep from "lodash-es/cloneDeep";
import type { UseFormReturn } from "react-hook-form";
import { Controller } from "react-hook-form";

import { CustomFieldValueField } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValueField";

type WithCustomFieldValues = {
  customFieldValues: Record<string, CustomFieldValue | undefined>;
} & Record<string, unknown>;

export type FormWithCustomFieldValues = UseFormReturn<WithCustomFieldValues>;

function CustomFieldValuesFormItem({
  form,
  property,
  variant = "primary",
}: {
  form: FormWithCustomFieldValues;
  property: Property;
  variant?: "primary" | "secondary";
}) {
  return (
    <Controller
      control={form.control}
      name={`customFieldValues.${property.id}`}
      rules={{
        required: property.required,
      }}
      render={({ field }) => {
        const customFieldValue =
          field.value ?? new CustomFieldValue({ property, value: { case: undefined } });

        return (
          <CustomFieldValueField
            variant={variant}
            customFieldValue={customFieldValue}
            error={!!form.formState.errors.customFieldValues?.[property.id]}
            onChange={(value) => {
              form.setValue(`customFieldValues.${property.id}`, _cloneDeep(value));
            }}
          />
        );
      }}
    />
  );
}

export function CustomFieldValuesForm({
  form,
  variant = "primary",
  properties,
}: {
  form: FormWithCustomFieldValues;
  variant?: "primary" | "secondary";
  properties?: Property[];
}): React.ReactNode {
  return properties?.map((property) => {
    return (
      <CustomFieldValuesFormItem
        key={property.id}
        form={form}
        property={property}
        variant={variant}
      />
    );
  });
}
