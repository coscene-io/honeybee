import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { MoreVertical24Filled } from "@fluentui/react-icons";
import { Avatar, Button, Card, CardActions, CardContent, CardHeader, Divider, IconButton, Typography, } from "@mui/material";
export default {
    title: "Theme/Data Display/Card",
};
export const BasicCard = {
    render: () => (_jsxs(Card, { style: { minWidth: 275, margin: 16 }, children: [_jsx(CardHeader, { avatar: _jsx(Avatar, { children: _jsx("b", { children: "B" }) }), action: _jsx(IconButton, { children: _jsx(MoreVertical24Filled, {}) }), title: "Word of the day", subheader: _jsx(_Fragment, { children: "be \u2022 nev \u2022 o \u2022 lent" }), slotProps: {
                    title: {
                        variant: "body2",
                        color: "text.secondary",
                    },
                    subheader: {
                        variant: "h5",
                    },
                } }), _jsx(Divider, {}), _jsxs(CardContent, { children: [_jsx(Typography, { color: "text.secondary", gutterBottom: true, children: "adjective" }), _jsxs(Typography, { variant: "body2", children: ["well meaning and kindly.", _jsx("br", {}), "\u201Ca benevolent smile\u201D"] })] }), _jsx(Divider, {}), _jsx(CardActions, { children: _jsx(Button, { size: "small", children: "Learn More" }) })] })),
};
