// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { TextValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { FilledInput } from "@mui/material";
import { useEffect, useState } from "react";

export function CustomFieldStringEditor({
  error,
  onChange,
  customFieldValue,
  disabled,
}: {
  error?: boolean;
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  const [value, setValue] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (customFieldValue.value.case === "text" && value == undefined) {
      setValue(customFieldValue.value.value.value);
    }
  }, [customFieldValue.value, value]);

  const onSave = (value: string) => {
    if (value) {
      customFieldValue.value = {
        case: "text",
        value: new TextValue({ value }),
      };
    } else {
      customFieldValue.value = {
        case: undefined,
      };
    }
    onChange(customFieldValue);
  };

  return (
    <FilledInput
      size="small"
      value={value}
      error={error}
      disabled={disabled}
      placeholder={customFieldValue.property?.description}
      onChange={(event) => {
        if (customFieldValue.property?.required === true && event.target.value === "") {
          return;
        }
        setValue(event.target.value);
        onSave(event.target.value);
      }}
    />
  );
}
