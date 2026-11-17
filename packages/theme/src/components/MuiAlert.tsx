// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ErrorCircle20Regular,
  Info20Regular,
  CheckmarkCircle20Regular,
  Warning20Regular,
} from "@fluentui/react-icons";
import { alertClasses, PaletteOptions, darken, lighten } from "@mui/material";

import { OverrideComponentReturn } from "../types";

declare module "@mui/material/Alert" {
  interface AlertPropsColorOverrides {
    primary: true;
  }
}

// Attempt to replicate MUI theme color variations
// https://github.com/mui/material-ui/tree/master/packages/mui-material/src/Alert/Alert.js#L45-L46

function getColor(mode: PaletteOptions["mode"], color: string, opacity: number) {
  return mode === "light" ? darken(color, opacity) : lighten(color, opacity);
}

function getBackgroundColor(mode: PaletteOptions["mode"], color: string, opacity: number) {
  return mode === "light" ? lighten(color, opacity) : darken(color, opacity);
}

export const MuiAlert: OverrideComponentReturn<"MuiAlert"> = {
  defaultProps: {
    iconMapping: {
      error: <ErrorCircle20Regular />,
      info: <Info20Regular />,
      success: <CheckmarkCircle20Regular />,
      warning: <Warning20Regular />,
      primary: <Info20Regular />,
    },
  },
  styleOverrides: {
    message: {
      lineHeight: "1.5",
    },
    root: ({ theme, ownerState }) => ({
      ...(ownerState.color === "primary" &&
        ownerState.variant === "filled" && {
          backgroundColor:
            theme.palette.mode === "dark" ? theme.palette.primary.dark : theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          fontWeight: theme.typography.fontWeightMedium,
        }),
      ...(ownerState.color === "primary" &&
        ownerState.variant === "outlined" && {
          color: getColor(theme.palette.mode, theme.palette.primary.light, 0.6),
          border: `1px solid ${theme.palette.primary.light}`,
          [`& .${alertClasses.icon}`]: { color: theme.palette.primary.main },
        }),
      ...(ownerState.color === "primary" &&
        ownerState.variant === "standard" && {
          borderColor: theme.palette.primary.main,
          color: getColor(theme.palette.mode, theme.palette.primary.main, 0.6),
          backgroundColor: getBackgroundColor(theme.palette.mode, theme.palette.primary.main, 0.9),
          [`& .${alertClasses.icon}`]: { color: theme.palette.primary.main },
        }),
      ...(ownerState.variant === "standard" && {
        [`&.${alertClasses.colorWarning}`]: { borderColor: theme.palette.warning.main },
        [`&.${alertClasses.colorError}`]: { borderColor: theme.palette.error.main },
        [`&.${alertClasses.colorInfo}`]: { borderColor: theme.palette.info.main },
        [`&.${alertClasses.colorSuccess}`]: { borderColor: theme.palette.success.main },
      }),
    }),
    standard: {
      border: "1px solid",
    },
  },
};
