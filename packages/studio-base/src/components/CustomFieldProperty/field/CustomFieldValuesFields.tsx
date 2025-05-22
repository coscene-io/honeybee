// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { CustomFieldValuesFindByPropery } from "./CustomFieldValuesFindByPropery";

export function CustomFieldValuesFields({
  properties,
  customFieldValues,
  readonly = false,
  onChange,
  variant = "primary",
}: {
  properties: Property[];
  customFieldValues: CustomFieldValue[];
  readonly?: boolean;
  onChange?: (customFieldValues: CustomFieldValue[]) => void;
  variant?: "primary" | "secondary";
}): React.ReactNode {
  return (
    <>
      {properties.map((property) => {
        return (
          <CustomFieldValuesFindByPropery
            key={property.id}
            property={property}
            customFieldValues={customFieldValues}
            readonly={readonly}
            onChange={onChange}
            variant={variant}
          />
        );
      })}
    </>
  );
}
