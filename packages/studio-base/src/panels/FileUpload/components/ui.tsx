// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React from "react";

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div>{right}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "medium" | "large";
}

export function Button({ variant = "primary", size = "medium", children, ...props }: ButtonProps) {
  const baseStyles = {
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    fontWeight: "500",
    transition: "all 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
  };

  const sizeStyles = {
    medium: {
      padding: "8px 16px",
      fontSize: "14px",
      minHeight: "36px",
    },
    large: {
      padding: "10px 20px",
      fontSize: "15px",
      minHeight: "40px",
    },
  };

  const variants = {
    primary: {
      backgroundColor: "#ffffff",
      color: "#000000",
      border: "1px solid #d1d5db",
      ":hover": {
        backgroundColor: "#f9fafb",
      },
    },
    ghost: {
      backgroundColor: "transparent",
      color: "#6b7280",
      border: "1px solid #d1d5db",
      ":hover": {
        backgroundColor: "#f3f4f6",
        color: "#374151",
      },
    },
    danger: {
      backgroundColor: "#ef4444",
      color: "white",
      ":hover": {
        backgroundColor: "#dc2626",
      },
    },
  };

  const variantStyles = variants[variant];
  const currentSizeStyles = sizeStyles[size];
  const combinedStyles = { ...baseStyles, ...currentSizeStyles, ...variantStyles };

  return (
    <button
      {...props}
      style={{
        ...combinedStyles,
        ...(props.disabled && {
          opacity: 0.5,
          cursor: "not-allowed",
        }),
        ...props.style,
      }}
      onMouseEnter={(e) => {
        if (!props.disabled && variantStyles[":hover"]) {
          Object.assign(e.currentTarget.style, variantStyles[":hover"]);
        }
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!props.disabled) {
          Object.assign(e.currentTarget.style, variantStyles);
        }
        props.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => { onChange(e.target.checked); }} />
      {label && <span>{label}</span>}
    </label>
  );
}