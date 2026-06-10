// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiAvatar = {
    defaultProps: {
        variant: "rounded",
    },
    styleOverrides: {
        colorDefault: ({ theme }) => ({
            color: "currentColor",
            backgroundColor: theme.palette.action.hover,
        }),
    },
};
