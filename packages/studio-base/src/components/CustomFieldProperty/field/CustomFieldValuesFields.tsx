// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import _debounce from "lodash/debounce";
import { memo, useEffect, useMemo } from "react";

import { CustomFieldValueField } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValueField";
import { stringifyWithBigint } from "@foxglove/studio-base/util/stringifyWithBigint";

function getCustomFieldValueSignature(customFieldValue: CustomFieldValue): string {
  return (
    stringifyWithBigint({
      propertyId: customFieldValue.property?.id,
      value: customFieldValue.value,
    }) ?? ""
  );
}

const CustomFieldValueItem = memo(
  function CustomFieldValueItem({
    customFieldValue,
    readonly,
    onChange,
    valueSignature,
    variant,
  }: {
    customFieldValue: CustomFieldValue;
    readonly: boolean;
    onChange?: (customFieldValue: CustomFieldValue) => void;
    valueSignature: string;
    variant: "primary" | "secondary";
  }): React.ReactNode {
    void valueSignature;

    const debouncedOnChange = useMemo(
      () =>
        onChange
          ? _debounce((value: CustomFieldValue) => {
              onChange(value);
            }, 300)
          : undefined,
      [onChange],
    );

    useEffect(() => {
      return () => {
        debouncedOnChange?.cancel();
      };
    }, [debouncedOnChange]);

    return (
      <CustomFieldValueField
        variant={variant}
        customFieldValue={customFieldValue}
        readonly={readonly}
        onChange={debouncedOnChange}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.readonly === nextProps.readonly &&
    prevProps.variant === nextProps.variant &&
    prevProps.valueSignature === nextProps.valueSignature,
);

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
  onChange?: (customFieldValue: CustomFieldValue) => void;
  variant?: "primary" | "secondary";
  ignoreProperties?: boolean;
}): React.ReactNode {
  const customFieldValueByPropertyId = useMemo(() => {
    return new Map(
      customFieldValues.map((customFieldValue) => [
        customFieldValue.property?.id,
        customFieldValue,
      ]),
    );
  }, [customFieldValues]);

  if (ignoreProperties) {
    return customFieldValues.map((customFieldValue, index) => (
      <CustomFieldValueItem
        key={customFieldValue.property?.id ?? index}
        variant={variant}
        customFieldValue={customFieldValue}
        readonly={readonly}
        onChange={onChange}
        valueSignature={getCustomFieldValueSignature(customFieldValue)}
      />
    ));
  }

  return (
    <>
      {properties.map((property) => {
        const customFieldValue =
          customFieldValueByPropertyId.get(property.id) ??
          create(CustomFieldValueSchema, { property });

        return (
          <CustomFieldValueItem
            key={property.id}
            customFieldValue={customFieldValue}
            readonly={readonly}
            onChange={onChange}
            variant={variant}
            valueSignature={getCustomFieldValueSignature(customFieldValue)}
          />
        );
      })}
    </>
  );
}
