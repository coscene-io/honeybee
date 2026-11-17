// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FormControl, InputLabel, Select, MenuItem, Box, SelectChangeEvent } from "@mui/material";
import { memo } from "react";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()(() => ({
  layout1: {
    minWidth: 200,
  },
}));

interface ProjectSelectorProps {
  projectName: string;
  projectOptions: { label: string; value: string }[];
  onProjectChange: (projectName: string) => void;
  onClearFocusedTask: () => void;
  disabled?: boolean;
  label: string;
}

export const ProjectSelector = memo(function ProjectSelector({
  projectName,
  projectOptions,
  onProjectChange,
  onClearFocusedTask,
  disabled = false,
  label,
}: ProjectSelectorProps) {
  const { classes } = useStyles();

  return (
    <Box className={classes.layout1}>
      <FormControl fullWidth size="small">
        <InputLabel id="project-select-label" required>
          {label}
        </InputLabel>
        <Select
          labelId="project-select-label"
          id="project-select"
          value={projectName}
          label={label}
          disabled={disabled}
          onChange={(event: SelectChangeEvent) => {
            onClearFocusedTask();
            onProjectChange(event.target.value);
          }}
        >
          {projectOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
});
