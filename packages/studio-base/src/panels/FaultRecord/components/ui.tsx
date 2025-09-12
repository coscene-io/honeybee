// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React from "react";

export { default as ActionNameSelector } from "./ActionNameSelector";
export { default as DurationInput } from "./DurationInput";
export { default as RecordButton } from "./RecordButton";

export function Button({
  onClick,
  disabled,
  variant = "primary",
  size = "default",
  style,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  size?: "default" | "large";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const baseStyles: React.CSSProperties = {
    borderRadius: '12px',
    fontWeight: 500,
    transition: 'all 0.2s ease',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: 'none',
    outline: 'none',
  };
  
  const sizeStyles: Record<string, React.CSSProperties> = {
    default: {
      padding: '6px 12px',
      fontSize: '14px',
      minHeight: '32px',
    },
    large: {
      padding: '8px 14px',
      fontSize: '15px',
      minHeight: '35px',
    },
  };
  
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#ffffff',
      color: '#000000',
      border: '1px solid #d1d5db',
    },
    ghost: {
      backgroundColor: '#ffffff',
      color: '#374151',
      border: '1px solid #d1d5db',
    },
    danger: {
      backgroundColor: '#dc2626',
      color: '#ffffff',
    },
  };
  
  const hoverStyles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: '#f9fafb' },
    ghost: { backgroundColor: '#f9fafb' },
    danger: { backgroundColor: '#b91c1c' },
  };
  
  const combinedStyles = {
    ...baseStyles,
    ...sizeStyles[size],
    ...variantStyles[variant],
    ...style,
  };
  
  return (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      style={combinedStyles}
      onMouseEnter={(e) => {
        if (!disabled) {
          Object.assign(e.currentTarget.style, hoverStyles[variant]);
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          Object.assign(e.currentTarget.style, variantStyles[variant]);
        }
      }}
    >
      {children}
    </button>
  );
}