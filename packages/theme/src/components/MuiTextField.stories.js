import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import { Autocomplete, FormControl, InputAdornment, InputLabel, MenuItem, Select, TextField as MuiTextField, Typography, } from "@mui/material";
import { Fragment } from "react";
const options = [{ label: "Small" }, { label: "Medium" }];
const sizes = ["small", "medium"];
const variants = ["outlined", "filled", "standard"];
export default {
    title: "Theme/Inputs/TextField",
    args: {
        color: "primary",
    },
    argTypes: {
        color: {
            options: ["error", "primary", "secondary", "info", "success", "warning"],
            control: { type: "radio" },
        },
    },
    parameters: { colorScheme: "light" },
    decorators: [
        (_StoryFn, { args: { color } }) => {
            const sharedProps = (variant, size) => ({
                defaultValue: size,
                error: color === "error",
                size,
                variant,
            });
            return (_jsx("div", { style: {
                    overflow: "auto",
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 150px)",
                    alignItems: "flex-end",
                    padding: 16,
                    columnGap: 16,
                    rowGap: 12,
                }, children: variants.map((variant) => {
                    return (_jsxs(Fragment, { children: [_jsx(Typography, { variant: "overline", style: { gridColumn: "span 7" }, children: variant }), sizes.map((size) => (_jsxs(Fragment, { children: [_jsx(MuiTextField, { ...sharedProps(variant, size), color: color, label: "Default" }), _jsx(MuiTextField, { ...sharedProps(variant, size), color: color, label: "Placeholder", placeholder: size }), _jsx(MuiTextField, { ...sharedProps(variant, size), focused: true, color: color, label: "Focused" }), _jsx(MuiTextField, { ...sharedProps(variant, size), color: color, label: "Disabled", disabled: true }), _jsx(MuiTextField, { ...sharedProps(variant, size), color: color, placeholder: size, slotProps: {
                                            input: {
                                                startAdornment: (_jsx(InputAdornment, { position: "start", children: _jsx(SearchIcon, { fontSize: "small" }) })),
                                                endAdornment: (_jsx(InputAdornment, { position: "end", children: _jsx(FilterListIcon, { fontSize: "small" }) })),
                                            },
                                        } }), _jsx(Autocomplete, { value: { label: size }, getOptionLabel: (option) => option.label, options: options, renderInput: (params) => (_jsx(MuiTextField, { ...params, ...sharedProps(variant, size), color: color, label: "Autocomplete", id: `autocomplete-${variant}-${size}` })) }), _jsxs(FormControl, { color: color, variant: variant, children: [_jsx(InputLabel, { id: `${variant}-${size}-select-label`, children: "Select" }), _jsx(Select, { labelId: `${variant}-${size}-select-label`, id: `${variant}-${size}-select`, ...sharedProps(variant, size), children: _jsx(MenuItem, { value: size, children: size }) })] })] }, size)))] }, variant));
                }) }));
        },
    ],
};
export const DefaultLight = {};
export const DefaultDark = {
    parameters: { colorScheme: "dark" },
};
export const ErrorLight = {
    args: { color: "error" },
};
export const ErrorDark = {
    args: { color: "error" },
    parameters: { colorScheme: "dark" },
};
