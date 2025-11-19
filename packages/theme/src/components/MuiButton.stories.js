import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Delete20Regular, Send20Filled } from "@fluentui/react-icons";
import { Button, Stack } from "@mui/material";
import { Fragment } from "react";
const variants = ["text", "outlined", "contained"];
const sizes = ["small", "medium", "large"];
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
    component: Button,
    title: "Theme/Inputs/Button",
    decorators: [
        (Story) => {
            return (_jsx(Stack, { direction: "row", padding: 2, gap: 1, justifyContent: "center", alignItems: "center", children: _jsx(Story, {}) }));
        },
    ],
    parameters: {
        colorScheme: "both-column",
    },
};
export const Default = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "text", children: "Text" }), _jsx(Button, { variant: "contained", children: "Contained" }), _jsx(Button, { variant: "outlined", children: "Outlined" })] })),
};
export const TextButton = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Button, { children: "Primary" }), _jsx(Button, { disabled: true, children: "Disabled" }), _jsx(Button, { href: "#text-buttons", target: "_self", children: "Link" })] })),
};
export const ContainedButton = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "contained", children: "Contained" }), _jsx(Button, { variant: "contained", disabled: true, children: "Disabled" }), _jsx(Button, { variant: "contained", href: "#contained-buttons", target: "_self", children: "Link" })] })),
};
export const DisableElevation = {
    args: {
        disableElevation: true,
        variant: "contained",
        children: "Disable Elevation",
    },
};
export const OutlinedButton = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outlined", children: "Primary" }), _jsx(Button, { variant: "outlined", disabled: true, children: "Disabled" }), _jsx(Button, { variant: "outlined", href: "#outlined-buttons", target: "_self", children: "Link" })] })),
};
export const Color = {
    render: () => (_jsx(Stack, { sx: { display: "grid", gridTemplateColumns: `repeat(${colors.length}, auto)`, gap: 1 }, children: variants.map((variant) => (_jsx(Fragment, { children: colors.map((color) => (_jsx(Button, { color, variant, children: color }, color))) }, variant))) })),
};
export const Sizes = {
    render: () => (_jsx(Stack, { gap: 2, children: variants.map((variant) => (_jsx(Stack, { direction: "row", alignItems: "center", gap: 2, children: sizes.map((size) => (_jsx(Button, { size, variant, children: size }, size))) }, variant))) })),
};
export const ButtonsWithIcons = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outlined", startIcon: _jsx(Delete20Regular, {}), children: "Delete" }), _jsx(Button, { variant: "contained", endIcon: _jsx(Send20Filled, {}), children: "Send" })] })),
};
