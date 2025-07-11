// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { NumberValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { FilledInput } from "@mui/material";
import { useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()(() => ({
  filledInput: {
    ".MuiInputBase-input": {
      "&::-webkit-outer-spin-button, &::-webkit-inner-spin-button": {
        appearance: "none",
        margin: 0,
      },
      MozAppearance: "textfield",
    },
  },
}));

export function CustomFieldNumberEditor({
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
  const { classes } = useStyles();
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    if (customFieldValue.value.case === "number") {
      setValue(customFieldValue.value.value.value.toString());
    } else {
      setValue("");
    }
  }, [customFieldValue.value]);

  const onSave = (value: string) => {
    if (value) {
      customFieldValue.value = {
        case: "number",
        value: new NumberValue({ value: Number(value) }),
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
      type="number"
      size="small"
      value={value}
      error={error}
      disabled={disabled}
      placeholder={customFieldValue.property?.description}
      onChange={(event) => {
        setValue(event.target.value);
        onSave(event.target.value);
      }}
      className={classes.filledInput}
    />
  );
}
