import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { ClockAlarm20Regular, Delete12Regular, Delete16Regular, Delete20Regular, Delete28Regular, Fingerprint20Regular, ShoppingBag20Regular, } from "@fluentui/react-icons";
import { IconButton as MuiIconButton, Stack } from "@mui/material";
const colors = [
    "inherit",
    "primary",
    "secondary",
    "success",
    "error",
    "info",
    "warning",
];
export default {
    component: MuiIconButton,
    title: "Theme/Inputs/Icon Button",
    args: {},
};
export const Default = {
    render: () => (_jsxs(Stack, { direction: "row", justifyContent: "center", alignItems: "center", padding: 2, children: [_jsx(MuiIconButton, { "aria-label": "delete", children: _jsx(Delete20Regular, {}) }), _jsx(MuiIconButton, { "aria-label": "delete", disabled: true, color: "primary", children: _jsx(Delete20Regular, {}) }), _jsx(MuiIconButton, { color: "secondary", "aria-label": "add an alarm", children: _jsx(ClockAlarm20Regular, {}) }), _jsx(MuiIconButton, { color: "primary", "aria-label": "add to shopping cart", children: _jsx(ShoppingBag20Regular, {}) })] })),
};
export const Sizes = {
    render: () => (_jsxs(Stack, { direction: "row", justifyContent: "center", alignItems: "center", padding: 2, children: [_jsx(MuiIconButton, { "aria-label": "delete", size: "small", children: _jsx(Delete12Regular, {}) }), _jsx(MuiIconButton, { "aria-label": "delete", size: "small", children: _jsx(Delete16Regular, {}) }), _jsx(MuiIconButton, { "aria-label": "delete", size: "large", children: _jsx(Delete20Regular, {}) }), _jsx(MuiIconButton, { "aria-label": "delete", size: "large", children: _jsx(Delete28Regular, {}) })] })),
};
export const Color = {
    render: () => (_jsx(Stack, { direction: "row", justifyContent: "center", alignItems: "center", padding: 2, children: colors.map((color) => (_jsx(MuiIconButton, { color, children: _jsx(Fingerprint20Regular, {}) }, color))) })),
};
