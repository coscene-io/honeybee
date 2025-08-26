// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React from "react";

import type { ActionNameConfig } from "../types";

interface ActionNameSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options: ActionNameConfig[];
  disabled?: boolean;
}

export default function ActionNameSelector({
  value,
  onChange,
  options,
  disabled = false,
}: ActionNameSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "8px 12px",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        fontSize: 14,
        backgroundColor: disabled ? "#f3f4f6" : "#ffffff",
        color: disabled ? "#6b7280" : "#111827",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <option value="" disabled>
        {options.length === 0 ? "加载中..." : "请选择Action"}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}