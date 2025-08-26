// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React from "react";

interface RecordButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  size?: "small" | "medium" | "large";
}

export default function RecordButton({
  onClick,
  disabled = false,
  loading = false,
  children,
  variant = "primary",
  size = "medium",
}: RecordButtonProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: disabled ? "#9ca3af" : "#3b82f6",
          color: "#ffffff",
          border: "1px solid transparent",
        };
      case "secondary":
        return {
          backgroundColor: disabled ? "#f3f4f6" : "#ffffff",
          color: disabled ? "#9ca3af" : "#374151",
          border: "1px solid #d1d5db",
        };
      case "danger":
        return {
          backgroundColor: disabled ? "#9ca3af" : "#ef4444",
          color: "#ffffff",
          border: "1px solid transparent",
        };
      default:
        return {
          backgroundColor: disabled ? "#9ca3af" : "#3b82f6",
          color: "#ffffff",
          border: "1px solid transparent",
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case "small":
        return {
          padding: "6px 12px",
          fontSize: 12,
        };
      case "medium":
        return {
          padding: "8px 16px",
          fontSize: 14,
        };
      case "large":
        return {
          padding: "12px 24px",
          fontSize: 16,
        };
      default:
        return {
          padding: "8px 16px",
          fontSize: 14,
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...variantStyles,
        ...sizeStyles,
        borderRadius: 6,
        fontWeight: 500,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "all 0.2s ease-in-out",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {loading && (
        <div
          style={{
            width: 16,
            height: 16,
            border: "2px solid transparent",
            borderTop: "2px solid currentColor",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
      )}
      {children}
    </button>
  );
}