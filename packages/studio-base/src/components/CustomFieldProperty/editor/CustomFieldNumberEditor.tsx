// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { NumberValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Input } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function CustomFieldNumberEditorState({
  initialValue,
  onChange,
  customFieldValue,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(initialValue);
  const { t } = useTranslation("general");

  const onSave = () => {
    setIsEditing(false);
    if (customFieldValue.property != undefined && customFieldValue.property.required && !text) {
      return;
    }
    onChange(text);
  };

  if (isEditing && disabled != undefined && !disabled) {
    return (
      <Input
        type="number"
        autoFocus
        value={text}
        placeholder={customFieldValue.property?.description}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={onSave}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            onSave();
          }
        }}
      />
    );
  }

  return (
    <div
      className="flex h-9 cursor-pointer items-center rounded border p-1 pl-2 hover:bg-gray-100"
      onClick={
        disabled != undefined && disabled
          ? undefined
          : () => {
              setText(initialValue);
              setIsEditing(true);
            }
      }
    >
      {initialValue || <span className=" text-gray-400">{t("pleaseSelect")}</span>}
    </div>
  );
}

export function CustomFieldNumberEditor({
  error,
  onChange,
  customFieldValue,
  disabled,
  enableState,
}: {
  error?: boolean;
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
  enableState?: boolean;
}): React.ReactNode {
  let value: number | undefined;
  if (customFieldValue.value.case === "number") {
    value = customFieldValue.value.value.value;
  }

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

  if (enableState != undefined && enableState) {
    return (
      <CustomFieldNumberEditorState
        initialValue={value?.toString() ?? ""}
        onChange={onSave}
        customFieldValue={customFieldValue}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      type="number"
      value={value}
      error={error}
      disabled={disabled}
      placeholder={customFieldValue.property?.description}
      onChange={(event) => {
        onSave(event.target.value);
      }}
    />
  );
}
