// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { MenuItem, Select, Chip, Box, SelectChangeEvent } from "@mui/material";
import { ReactElement } from "react";

import Stack from "@foxglove/studio-base/components/Stack";

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;

const MenuProps = {
  PaperProps: {
    style: {
      maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
      width: 250,
    },
  },
};

export default function RecordLabelSelector({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: Label[];
  onChange: (event: SelectChangeEvent<string[]>) => void;
}): ReactElement {
  return (
    <Stack fullWidth>
      <Select
        labelId="demo-multiple-chip-label"
        id="demo-multiple-chip"
        multiple
        value={value}
        onChange={onChange}
        renderValue={(selected) => (
          <Box style={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selected.map((label) => {
              const option = options.find((o) => o.name === label);
              return <Chip key={label} label={option?.displayName} size="small" />;
            })}
          </Box>
        )}
        MenuProps={MenuProps}
      >
        {options.map((option) => (
          <MenuItem key={option.name} value={option.name}>
            {option.displayName}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}
