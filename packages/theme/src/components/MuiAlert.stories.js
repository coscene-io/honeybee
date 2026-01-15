import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { AlertTitle, Alert as MuiAlert, Stack } from "@mui/material";
const severities = ["error", "info", "success", "warning", "primary"];
export default {
    component: MuiAlert,
    title: "Theme/Feedback/Alert",
    args: {
        showTitle: false,
    },
    decorators: [
        (_, { args: { showTitle, ...args } }) => (_jsx(Stack, { gap: 2, padding: 2, children: severities.map((severity) => (_jsxs(MuiAlert, { variant: args.variant, severity: severity, children: [showTitle === true && _jsx(AlertTitle, { children: severity }), "This is a ", severity, " alert \u2014 check it out!"] }, severity))) })),
    ],
};
export const StandardVariant = {
    args: { variant: "standard" },
};
export const OutlinedVariant = {
    args: { variant: "outlined" },
};
export const FilledVariant = {
    args: { variant: "filled" },
};
export const Description = {
    args: { showTitle: true },
};
