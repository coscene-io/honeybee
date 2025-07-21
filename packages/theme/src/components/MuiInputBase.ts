// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { inputBaseClasses } from "@mui/material";

import { OverrideComponentReturn } from "../types";

export const MuiInputBase: OverrideComponentReturn<"MuiInputBase"> = {
  styleOverrides: {
    root: ({ theme }) => ({
      [`&.${inputBaseClasses.adornedStart}`]: {
        paddingInlineStart: theme.spacing(1.25),
      },
      [`&.${inputBaseClasses.adornedEnd}`]: {
        paddingInlineEnd: theme.spacing(1.25),
      },
      [`&.${inputBaseClasses.adornedStart} > .${inputBaseClasses.input}`]: {
        paddingInlineStart: theme.spacing(1),
      },
      [`&.${inputBaseClasses.adornedEnd} > .${inputBaseClasses.input}`]: {
        paddingInlineEnd: theme.spacing(1),
      },
    }),
    sizeSmall: ({ theme }) => ({
      [`&.${inputBaseClasses.adornedStart}`]: {
        paddingInlineStart: theme.spacing(1),
      },
      [`&.${inputBaseClasses.adornedEnd}`]: {
        paddingInlineEnd: theme.spacing(1),
      },
      [`&.${inputBaseClasses.adornedStart} > .${inputBaseClasses.input}`]: {
        paddingInlineStart: theme.spacing(0.75),
      },
      [`&.${inputBaseClasses.adornedEnd} > .${inputBaseClasses.input}`]: {
        paddingInlineEnd: theme.spacing(0.75),
      },
    }),
    input: {
      "::placeholder": {
        transition: "none",
        opacity: 0.6,
      },
    },
    inputSizeSmall: ({ theme }) => ({
      fontSize: theme.typography.body2.fontSize,
    }),
  },
};
