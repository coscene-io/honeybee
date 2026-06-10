import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Stack, Box, Typography, useTheme } from "@mui/material";
export default {
    title: "Theme/Palette",
};
export const Palette = {
    render: function Story() {
        const theme = useTheme();
        return (_jsxs(Stack, { height: "100%", width: "100%", flexWrap: "wrap", padding: 2, gap: 6, bgcolor: "background.paper", children: [_jsxs(Stack, { direction: "row", gap: 6, children: [_jsxs(Stack, { gap: 1, children: [_jsx(Typography, { variant: "overline", children: "Palette" }), _jsx(Stack, { direction: "row", alignItems: "center", gap: 1, children: ["dark", "main", "light"].map((variant) => (_jsx(Box, { display: "flex", width: 32, alignItems: "center", justifyContent: "center", children: variant }, variant))) }), ["primary", "secondary", "error", "warning", "info", "success"].map((color) => (_jsxs(Stack, { direction: "row", alignItems: "center", gap: 1, children: [["dark", "main", "light"].map((variant) => (_jsx(Box, { display: "flex", width: 32, height: 32, bgcolor: `${color}.${variant}`, color: `${color}.contrastText`, alignItems: "center", justifyContent: "center", children: "Aa" }, `${color}.${variant}`))), color] }, color)))] }), _jsxs(Stack, { gap: 1, children: [_jsx(Typography, { variant: "overline", children: "Action" }), ["hover", "focus", "selected", "disabled", "active"].map((color) => (_jsxs(Stack, { direction: "row", alignItems: "center", gap: 1, children: [_jsx(Box, { display: "flex", width: 32, height: 32, bgcolor: `action.${color}`, alignItems: "center", justifyContent: "center", children: "Aa" }), color] }, color)))] }), _jsxs(Stack, { gap: 1, children: [_jsx(Typography, { variant: "overline", children: "Background" }), Object.keys(theme.palette.background).map((bgcolor) => (_jsxs(Stack, { direction: "row", alignItems: "center", gap: 1, children: [_jsx(Box, { display: "flex", width: 32, height: 32, bgcolor: `background.${bgcolor}`, alignItems: "center", justifyContent: "center", border: "1px solid", borderColor: "divider", children: "Aa" }), _jsx(Box, { display: "flex", width: 32, height: 32, bgcolor: `background.${bgcolor}`, alignItems: "center", justifyContent: "center", boxShadow: 8, children: "Aa" }), bgcolor] }, bgcolor)))] })] }), _jsxs(Stack, { gap: 1, children: [_jsx(Typography, { variant: "overline", children: "Grey (with Divider border)" }), _jsx(Stack, { gap: 1, direction: "row", alignItems: "center", children: Object.keys(theme.palette.grey).map((key) => (_jsxs(Stack, { alignItems: "center", gap: 1, children: [_jsx(Box, { display: "flex", width: 32, height: 32, bgcolor: `grey.${key}`, alignItems: "center", justifyContent: "center", border: "1px solid", borderColor: "divider", children: "Aa" }), key] }, key))) })] })] }));
    },
};
