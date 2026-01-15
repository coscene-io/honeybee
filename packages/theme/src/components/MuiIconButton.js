// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiIconButton = {
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
