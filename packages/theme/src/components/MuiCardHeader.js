// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
export const MuiCardHeader = {
    defaultProps: {
        titleTypographyProps: {
            variant: "h4",
        },
    },
    styleOverrides: {
        avatar: {
            marginRight: 0,
        },
        action: {
            alignSelf: "auto",
            marginTop: 0,
            marginRight: 0,
        },
        root: ({ theme }) => ({
            gap: theme.spacing(2),
        }),
    },
};
