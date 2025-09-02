// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { Autocomplete, TextField, Chip } from "@mui/material";
import { ReactElement, useState } from "react";
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
    height: "20px",
    fontSize: "12px",
    transform: "scale(0.85)",
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

interface LabelSelectorProps {
  value: Label[];
  options: Label[];
  onChange: (labels: Label[]) => void;
  disabled?: boolean;
}

export default function LabelSelector({
  value,
  options,
  onChange,
  disabled = false,
}: LabelSelectorProps): ReactElement {
  const { classes } = useStyles();
  const [inputValue, setInputValue] = useState("");

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Autocomplete
        multiple
        size="small"
        disabled={disabled}
        options={options}
        value={value}
        inputValue={inputValue}
        onInputChange={(_, newInputValue) => {
          setInputValue(newInputValue);
        }}
        onChange={(_, newValue) => {
          onChange(newValue);
        }}
        getOptionLabel={(option) => option.displayName ?? option.name ?? ""}
        isOptionEqualToValue={(option, val) => option.name === val.name}
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((option, index) => {
            const { key, ...tagProps } = getTagProps({ index });
            return (
              <Chip
                key={key}
                variant="outlined"
                label={option.displayName ?? option.name}
                size="small"
                {...tagProps}
                className={classes.chip}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            variant="outlined"
            placeholder="Select labels"
            size="small"
            sx={{
              minWidth: 150,
              maxWidth: 350,
              "& .MuiOutlinedInput-root": {
                paddingTop: "2px",
                paddingBottom: "2px",
                fontSize: "14px",
              },
              "& .MuiInputBase-input": {
                fontSize: "14px",
              },
            }}
          />
        )}
        classes={{
          clearIndicator: disabled ? classes.clearIndicatorHide : classes.clearIndicatorShow,
          popupIndicator: disabled ? classes.popupIndicatorHide : classes.popupIndicatorShow,
        }}
        sx={{
          flexGrow: 1,
          "& .MuiAutocomplete-inputRoot": {
            paddingRight: "9px !important",
          },
        }}
      />
    </Stack>
  );
}