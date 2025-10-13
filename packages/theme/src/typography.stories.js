import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Stack, Typography as MuiTypography } from "@mui/material";
export default {
    title: "Theme/Data Display/Typography",
};
function Wrapper({ children }) {
    return _jsx(Stack, { sx: { border: "1px dotted", borderColor: "info.main" }, children: children });
}
export const Variants = {
    render: function Story() {
        return (_jsxs(Stack, { gap: 1, padding: 1, children: [_jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h1", gutterBottom: true, children: "h1. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h2", gutterBottom: true, children: "h2. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h3", gutterBottom: true, children: "h3. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h4", gutterBottom: true, children: "h4. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h5", gutterBottom: true, children: "h5. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "h6", gutterBottom: true, children: "h6. Heading" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "subtitle1", gutterBottom: true, children: "subtitle1. Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quos blanditiis tenetur" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "subtitle2", gutterBottom: true, children: "subtitle2. Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quos blanditiis tenetur" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "body1", gutterBottom: true, children: "body1. Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quos blanditiis tenetur unde suscipit, quam beatae rerum inventore consectetur, neque doloribus, cupiditate numquam dignissimos laborum fugiat deleniti? Eum quasi quidem quibusdam." }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "body2", gutterBottom: true, children: "body2. Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quos blanditiis tenetur unde suscipit, quam beatae rerum inventore consectetur, neque doloribus, cupiditate numquam dignissimos laborum fugiat deleniti? Eum quasi quidem quibusdam." }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "button", display: "block", gutterBottom: true, children: "button text" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "caption", display: "block", gutterBottom: true, children: "caption text" }) }), _jsx(Wrapper, { children: _jsx(MuiTypography, { variant: "overline", display: "block", gutterBottom: true, children: "overline text" }) })] }));
    },
    parameters: { colorScheme: "light" },
};
const fontFeatures = [
    { label: "tnum", text: "0123456789" },
    { label: "calt", text: "=> == === 1x1 2*2 3xA ++ :=" },
    // we don't currently use these ligatures but putting it in just so we never forget it exists
    { label: "cv08 / cv10", text: "显示时间戳在" },
];
export const FontFeatureSettings = {
    render: () => (_jsx("table", { children: _jsx("tbody", { children: fontFeatures.map(({ label, text }) => (_jsxs("tr", { children: [_jsx("th", { style: { width: 100 }, children: label }), " ", _jsx("td", { children: text })] }, label))) }) })),
    parameters: { colorScheme: "light" },
};
export const FontFeatureSettingsChinese = {
    ...FontFeatureSettings,
    parameters: { forceLanguage: "zh", colorScheme: "light" },
};
export const FontFeatureSettingsJapanese = {
    ...FontFeatureSettings,
    parameters: { forceLanguage: "ja", colorScheme: "light" },
};
