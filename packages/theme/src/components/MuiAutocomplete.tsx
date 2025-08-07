// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CancelIcon from "@mui/icons-material/Cancel";
import { autocompleteClasses, inputBaseClasses } from "@mui/material";

import { OverrideComponentReturn } from "../types";

export const MuiAutocomplete: OverrideComponentReturn<"MuiAutocomplete"> = {
  defaultProps: {
    clearIcon: <CancelIcon fontSize="inherit" />,
    componentsProps: {
      clearIndicator: {
        size: "small",
      },
    },
  },
  styleOverrides: {
    root: {
      minWidth: 144,
    },
    inputRoot: ({ theme }) => ({
      [`&.${inputBaseClasses.root}`]: {
        padding: theme.spacing(1, 1.25),

        [`.${autocompleteClasses.input}`]: {
          padding: 0,
        },
        [`&.${inputBaseClasses.sizeSmall}`]: {
          padding: theme.spacing(0.75, 1),
        },
      },
      [`.${autocompleteClasses.input}.${inputBaseClasses.input}.${inputBaseClasses.adornedEnd}`]: {
        paddingRight: theme.spacing(2),
      },
    }),
    clearIndicator: ({ theme }) => ({
      marginRight: theme.spacing(-0.5),
      opacity: theme.palette.action.disabledOpacity,

      ":hover": {
        background: "transparent",
        opacity: 1,
      },
    }),
    endAdornment: ({ theme }) => ({
      display: "flex",
      alignItems: "center",

      [`.${autocompleteClasses.root} .${inputBaseClasses.sizeSmall}.${inputBaseClasses.root} &`]: {
        right: theme.spacing(0.75),
      },
    }),
  },
};
