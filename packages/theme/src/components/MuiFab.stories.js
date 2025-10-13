import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Add20Filled, Edit20Filled, Heart20Filled, Toolbox20Filled } from "@fluentui/react-icons";
import { Fab, Stack } from "@mui/material";
const variants = ["circular", "extended"];
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
    component: Fab,
    title: "Theme/Inputs/Floating Action Button",
    decorators: [
        (Story) => {
            return (_jsx(Stack, { direction: "row", padding: 2, gap: 2, justifyContent: "center", alignItems: "center", children: _jsx(Story, {}) }));
        },
    ],
    parameters: {
        colorScheme: "both-column",
    },
};
export const Default = {
    render: () => (_jsxs(_Fragment, { children: [_jsx(Fab, { color: "primary", "aria-label": "add", children: _jsx(Add20Filled, {}) }), _jsx(Fab, { color: "secondary", "aria-label": "edit", children: _jsx(Edit20Filled, {}) }), _jsxs(Fab, { variant: "extended", children: [_jsx(Toolbox20Filled, {}), "Tools"] }), _jsx(Fab, { disabled: true, "aria-label": "like", children: _jsx(Heart20Filled, {}) })] })),
};
export const Colors = {
    render: () => (_jsx(_Fragment, { children: colors.map((color) => (_jsx(Fab, { color: color, "aria-label": color, children: _jsx(Add20Filled, {}) }, color))) })),
};
export const SizesAndVariants = {
    render: () => (_jsx(Stack, { gap: 2, alignItems: "center", children: variants.map((variant) => (_jsx(Stack, { direction: "row", alignItems: "center", gap: 2, children: sizes.map((size) => (_jsxs(Fab, { color: "primary", size, variant, children: [_jsx(Add20Filled, {}), variant === "extended" && "Extended"] }, size))) }, variant))) })),
};
