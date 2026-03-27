// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiOutlinedInput = {
    defaultProps: {
        notched: false,
    },
    styleOverrides: {
        input: ({ theme }) => ({
            boxSizing: "content-box",
            padding: theme.spacing(1, 1.25),
        }),
        inputSizeSmall: ({ theme }) => ({
            padding: theme.spacing(0.75, 1),
        }),
    },
};
