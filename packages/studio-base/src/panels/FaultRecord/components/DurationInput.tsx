// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React from "react";

interface DurationInputProps {
  value: number | string;
  onChange: (value: number) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
}

export default function DurationInput({
  value,
  onChange,
  disabled = false,
  placeholder = "输入时长(秒)",
  label,
  min = 0,
  max,
  allowEmpty = false,
}: DurationInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // 如果允许空值且输入为空，则设置为0
    if (allowEmpty && inputValue === "") {
      onChange(0);
      return;
    }

    // 解析数值
    const numValue = parseInt(inputValue, 10);

    // 验证数值有效性
    if (!isNaN(numValue) && numValue >= min) {
      // 如果设置了max值且超过限制，则设置为max值
      if (max !== undefined && numValue > max) {
        onChange(max);
      } else {
        onChange(numValue);
      }
    }
  };

  return (
    <div style={{ width: "100%" }}>
      {label && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>}
      <input
        type="number"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        min={min}
        max={max}
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          fontSize: 14,
          backgroundColor: disabled ? "#f3f4f6" : "#ffffff",
          color: disabled ? "#6b7280" : "#111827",
        }}
      />
    </div>
  );
}
