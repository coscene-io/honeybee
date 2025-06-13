// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { OverrideComponentReturn } from "../types";

export const MuiDataGrid: OverrideComponentReturn<"MuiDataGrid"> = {
  defaultProps: {
    slotProps: {
      panel: {
        popperOptions: {
          placement: "bottom-end",
        },
      },
      baseTextField: {
        variant: "outlined",
        size: "small",
        label: undefined,
      },
    },
  },
  styleOverrides: {
    root: {},
    cell: {
      // Disable focus outline by default since most of our grids are used
      // as non-interactive display tables
      "&:focus": {
        outline: "none",
      },
    },
    columnsManagement: {
      padding: 0,
    },
    columnHeader: {
      // Disable focus outline by default since most of our grids are used
      // as non-interactive display tables
      "&:focus-within": {
        outline: "none",
      },
    },
    panelHeader: ({ theme }) => ({
      padding: theme.spacing(1.5),
    }),
    panelContent: ({ theme }) => ({
      padding: theme.spacing(0, 1.5, 1.5),
    }),
    panelFooter: ({ theme }) => ({
      borderTop: `1px solid ${theme.palette.divider}`,
    }),
  },
};
