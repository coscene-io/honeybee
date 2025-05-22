// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { CustomFieldValueFieldDisplay } from "./CustomFieldValueFieldDisplay";
import { CustomFieldValueFieldEditor } from "../editor/CustomFieldValueFieldEditor";

export function CustomFieldValueField({
  customFieldValue,
  readonly = false,
  error,
  onChange,
  variant = "primary",
}: {
  customFieldValue: CustomFieldValue;
  readonly?: boolean;
  error?: boolean;
  onChange?: (customFieldValue: CustomFieldValue) => void;
  variant?: "primary" | "secondary";
}): React.ReactNode {
  if (readonly || !onChange) {
    return <CustomFieldValueFieldDisplay variant={variant} customFieldValue={customFieldValue} />;
  }

  return (
    <CustomFieldValueFieldEditor
      variant={variant}
      customFieldValue={customFieldValue}
      error={error}
      onChange={onChange}
    />
  );
}
