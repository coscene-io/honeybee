// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiDialogActions = {
    styleOverrides: {
        root: ({ theme }) => ({
            gap: theme.spacing(1),
            padding: theme.spacing(3),
            "& > :not(:first-of-type)": {
                marginLeft: "inherit",
            },
        }),
    },
};
