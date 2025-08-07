// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { Autocomplete, TextField, Chip } from "@mui/material";
import { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";

export default function RecordLabelSelector({
  value,
  options,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[];
  options: Label[];
  onChange: (event: React.SyntheticEvent, newValue: Label[]) => void;
  placeholder?: string;
  disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation("cosGeneral");

  return (
    <Stack fullWidth>
      <Autocomplete
        multiple
        size="small"
        options={options}
        value={options.filter((option) => value.includes(option.name))}
        onChange={onChange}
        getOptionLabel={(option) => option.displayName}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        renderInput={(params) => (
          <TextField {...params} variant="filled" placeholder={placeholder ?? t("search")} />
        )}
        disabled={disabled}
        renderValue={(value, getTagProps) =>
          value.map((option, index) => {
            const { key: _key, ...tagProps } = getTagProps({ index });
            return (
              <Chip
                label={option.displayName}
                size="small"
                {...tagProps}
                style={{
                  marginRight: "0px",
                  height: "16px",
                  fontSize: "12px",
                  transform: "scale(0.9)",
                  transformOrigin: "left center",
                  marginTop: "-3px",
                  marginBottom: "-3px",
                }}
                key={`${option.name}-${index}`}
              />
            );
          })
        }
      />
    </Stack>
  );
}
