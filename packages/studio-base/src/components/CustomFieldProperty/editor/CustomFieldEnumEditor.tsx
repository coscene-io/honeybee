// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { EnumValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Autocomplete, TextField, Chip } from "@mui/material";
import _orderBy from "lodash/orderBy";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function CustomFieldEnumEditor({
  allowClear,
  error,
  onChange,
  customFieldValue,
  disabled,
}: {
  allowClear?: boolean;
  error?: boolean;
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  const { t } = useTranslation("general");
  const { property } = customFieldValue;

  const options = useMemo(() => {
    if (property?.type.case !== "enums") {
      return [];
    }

    const options = Object.entries(property.type.value.values).map(([key, value]) => {
      return {
        content: <div className="truncate">{value}</div>,
        keyword: value,
        value: key,
      };
    });

    return _orderBy(options, "keyword");
  }, [property]);

  if (property?.type.case === "enums" && property.type.value.multiple) {
    const value =
      customFieldValue.value.case === "enums"
        ? options.filter((option) =>
            (customFieldValue.value.value as EnumValue).ids.includes(option.value),
          )
        : [];

    return (
      <Autocomplete
        multiple
        size="small"
        disableClearable={allowClear === false}
        disableCloseOnSelect={true}
        onChange={(_, newValue) => {
          customFieldValue.value = {
            case: "enums",
            value: new EnumValue({ ids: newValue.map((v) => v.value) }),
          };
          onChange(customFieldValue);
        }}
        options={options}
        getOptionLabel={(option) => option.keyword}
        isOptionEqualToValue={(option, value) => option.value === value.value}
        value={value}
        disabled={disabled}
        noOptionsText={t("noMatchingItemsFound")}
        renderValue={(value, getTagProps) =>
          value.map((option, index) => {
            const { key: _key, ...tagProps } = getTagProps({ index });
            return (
              <Chip
                label={option.keyword}
                size="small"
                {...tagProps}
                key={`${option.value}-${index}`}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            error={error}
            variant="filled"
            placeholder={value.length > 0 ? undefined : property.description || t("pleaseSelect")}
            slotProps={{
              htmlInput: {
                ...params.inputProps,
                "aria-label": property.description || t("pleaseSelect"),
              },
            }}
          />
        )}
      />
    );
  }

  return (
    <Autocomplete
      size="small"
      disableClearable={allowClear === false}
      onChange={(_, newValue) => {
        if (newValue) {
          customFieldValue.value = { case: "enums", value: new EnumValue({ id: newValue.value }) };
          onChange(customFieldValue);
        }
      }}
      options={options}
      getOptionLabel={(option) => option.keyword}
      isOptionEqualToValue={(option, value) => option.value === value.value}
      value={
        options.find(
          (option) =>
            customFieldValue.value.case === "enums" &&
            option.value === customFieldValue.value.value.id,
        ) ?? undefined
      }
      disabled={disabled}
      noOptionsText={t("noMatchingItemsFound")}
      renderInput={(params) => (
        <TextField
          {...params}
          error={error}
          variant="filled"
          placeholder={property?.description ?? t("pleaseSelect")}
          slotProps={{
            htmlInput: {
              ...params.inputProps,
              "aria-label": property?.description ?? t("pleaseSelect"),
            },
          }}
        />
      )}
    />
  );
}
