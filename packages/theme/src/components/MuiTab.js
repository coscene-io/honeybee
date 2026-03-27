// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiTab = {
    styleOverrides: {
        root: ({ theme }) => ({
            opacity: 0.8,
            "&.Mui-selected": {
                opacity: 1,
            },
            "&:not(.Mui-selected):hover": {
                opacity: 1,
                color: theme.palette.text.primary,
            },
        }),
        selected: {},
    },
};
