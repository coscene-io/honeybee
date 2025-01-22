// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { OverrideComponentReturn } from "../types";

export const MuiIconButton: OverrideComponentReturn<"MuiIconButton"> = {
  defaultProps: {
    centerRipple: false,
    disableRipple: true,
  },
  styleOverrides: {
    root: ({ theme }) => ({
      borderRadius: theme.shape.borderRadius,
      transition: "none",

      "&:hover": {
        backgroundColor: theme.palette.action.hover,
      },
      "&:focus-visible": {
        outline: "1px solid currentColor",
        outlineOffset: -1,
      },
    }),
  },
};
