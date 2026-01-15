import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Alert24Filled } from "@fluentui/react-icons";
import { Badge as MuiBadge, Stack } from "@mui/material";
const colors = [
    "default",
    "primary",
    "secondary",
    "error",
    "info",
    "success",
    "warning",
];
export default {
    component: MuiBadge,
    title: "Theme/Data Display/Badge",
    args: {
        badgeContent: 4,
        children: _jsx(Alert24Filled, {}),
    },
    decorators: [
        (Story) => (_jsx(Stack, { direction: "row", gap: 2, padding: 2, children: _jsx(Story, {}) })),
    ],
};
export const Default = {
    render: (args) => (_jsx(_Fragment, { children: colors.map((color) => (_jsx(MuiBadge, { ...args, color }, color))) })),
};
