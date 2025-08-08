// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { Autocomplete, TextField, Chip } from "@mui/material";
import { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";

const useStyles = makeStyles()(() => ({
  chipContainer: {
    maxWidth: "70%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chip: {
    marginRight: "2px",
    height: "16px",
    fontSize: "12px",
    transform: "scale(0.9)",
    transformOrigin: "left center",
    overflow: "visible",
  },
  clearIndicatorShow: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "14px",
  },
  clearIndicatorHide: {
    display: "none",
  },
  popupIndicatorShow: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "14px",
  },
  popupIndicatorHide: {
    display: "none",
  },
}));

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
  const { classes, cx } = useStyles();
  const { t } = useTranslation("cosGeneral");
  const [open, setOpen] = useState(false);

  return (
    <Stack fullWidth>
      <Autocomplete
        onOpen={() => {
          setOpen(true);
        }}
        onClose={() => {
          setOpen(false);
        }}
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
        slotProps={{
          clearIndicator: {
            className: cx(classes.clearIndicatorHide, {
              [classes.clearIndicatorShow]: open && value.length > 0,
            }),
          },
          popupIndicator: {
            className: cx(classes.popupIndicatorShow, {
              [classes.popupIndicatorHide]: open,
            }),
          },
        }}
        renderValue={(value, getTagProps) => {
          return (
            <div className={classes.chipContainer}>
              {value.map((option, index) => {
                const { key: _key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    label={option.displayName}
                    size="small"
                    {...tagProps}
                    className={classes.chip}
                    key={`${option.name}-${index}`}
                  />
                );
              })}
            </div>
          );
        }}
      />
    </Stack>
  );
}
