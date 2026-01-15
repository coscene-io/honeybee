import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { Button, ButtonGroup, Stack } from "@mui/material";
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
    component: ButtonGroup,
    title: "Theme/Inputs/Button Group",
    decorators: [
        (Story) => {
            return (_jsx(Stack, { padding: 2, gap: 2, alignItems: "center", children: _jsx(Story, {}) }));
        },
    ],
    parameters: {
        colorScheme: "both-column",
    },
};
const buttons = [
    _jsx(Button, { children: "One" }, "one"),
    _jsx(Button, { children: "Two" }, "two"),
    _jsx(Button, { children: "Three" }, "three"),
];
export const Default = {
    args: {
        children: buttons,
    },
};
export const Variants = {
    render: () => (_jsx(_Fragment, { children: variants.map((variant) => (_jsx(ButtonGroup, { variant, "aria-label": `${variant} button group`, children: buttons }, variant))) })),
};
export const Colors = {
    render: () => (_jsx(_Fragment, { children: colors.map((color) => (_jsx(ButtonGroup, { color, variant: "contained", "aria-label": `${color} button group`, children: buttons }, color))) })),
};
export const Sizes = {
    render: () => (_jsx(_Fragment, { children: sizes.map((size) => (_jsx(ButtonGroup, { size, "aria-label": `${size} button group`, children: buttons }, size))) })),
};
export const Orientation = {
    render: () => (_jsx(Stack, { direction: "row", gap: 2, children: variants.map((variant) => (_jsx(ButtonGroup, { orientation: "vertical", variant, "aria-label": `${variant} button group`, children: buttons }, variant))) })),
};
export const SplitButton = {
    render: () => (_jsx(_Fragment, { children: variants.map((variant) => (_jsxs(ButtonGroup, { variant, "aria-label": `${variant} button group`, children: [_jsx(Button, { children: "Squash and merge" }), _jsx(Button, { size: "small", children: _jsx(ArrowDropDownIcon, {}) })] }, variant))) })),
};
export const DisableElevation = {
    args: {
        disableElevation: true,
        children: buttons,
        variant: "contained",
    },
};
