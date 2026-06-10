// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiFab = {
    defaultProps: {
        color: "inherit",
    },
    styleOverrides: {
        root: ({ theme }) => ({
            boxShadow: theme.shadows[2],
        }),
        colorInherit: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
        }),
        extended: ({ theme }) => ({
            gap: theme.spacing(1),
        }),
    },
};
