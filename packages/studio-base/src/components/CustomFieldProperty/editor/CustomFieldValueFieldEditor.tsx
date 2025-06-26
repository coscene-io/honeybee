// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { FormControl, FormLabel } from "@mui/material";

import { CustomFieldEnumEditor } from "./CustomFieldEnumEditor";
import { CustomFieldNumberEditor } from "./CustomFieldNumberEditor";
import { CustomFieldStringEditor } from "./CustomFieldStringEditor";
import { CustomFieldTimeEditor } from "./CustomFieldTimeEditor";
import { CustomFieldUserEditor } from "./CustomFieldUserEditor";

export function CustomFieldValueFieldEditor({
  customFieldValue,
  error,
  onChange,
  variant = "primary",
}: {
  customFieldValue: CustomFieldValue;
  error?: boolean;
  onChange: (customFieldValue: CustomFieldValue) => void;
  variant?: "primary" | "secondary";
}): React.ReactNode {
  let content;
  switch (customFieldValue.property?.type.case) {
    case "text":
      content = (
        <CustomFieldStringEditor
          error={error}
          onChange={onChange}
          customFieldValue={customFieldValue}
        />
      );
      break;

    case "number":
      content = (
        <CustomFieldNumberEditor
          error={error}
          onChange={onChange}
          customFieldValue={customFieldValue}
        />
      );
      break;

    case "enums":
      content = (
        <CustomFieldEnumEditor
          allowClear={!customFieldValue.property.required}
          customFieldValue={customFieldValue}
          onChange={onChange}
          error={error}
        />
      );
      break;

    case "time":
      content = (
        <CustomFieldTimeEditor
          customFieldValue={customFieldValue}
          onChange={onChange}
          error={error}
          allowClear={!customFieldValue.property.required}
        />
      );
      break;

    case "user":
      content = (
        <CustomFieldUserEditor
          customFieldValue={customFieldValue}
          onChange={onChange}
          error={error}
          allowClear={!customFieldValue.property.required}
        />
      );
      break;

    default:
      content = "-";
      break;
  }

  return (
    <FormControl>
      <FormLabel required={customFieldValue.property?.required} color={variant}>
        {customFieldValue.property?.name}
      </FormLabel>
      {content}
    </FormControl>
  );
}
