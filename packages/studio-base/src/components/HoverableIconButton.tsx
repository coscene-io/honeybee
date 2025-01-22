// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IconButton, Tooltip, IconButtonProps } from "@mui/material";
import { forwardRef, useCallback, useEffect, useState } from "react";

type Props = {
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
  color?: IconButtonProps["color"];
  activeColor?: IconButtonProps["color"];
  children?: React.ReactNode;
} & Omit<IconButtonProps, "children" | "color">;

const HoverableIconButton = forwardRef<HTMLButtonElement, Props>((props, ref) => {
  const {
    icon,
    activeIcon,
    title,
    color,
    activeColor,
    onMouseLeave,
    onMouseEnter,
    children,
    ...rest
  } = props;

  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(
    (event) => {
      if (onMouseEnter != undefined) {
        onMouseEnter(event);
      }
      if (props.disabled === true) {
        return;
      }
      setHovered(true);
    },
    [onMouseEnter, props.disabled],
  );

  const handleMouseLeave = useCallback(
    (event) => {
      if (onMouseLeave != undefined) {
        onMouseLeave(event);
      }
      setHovered(false);
    },
    [onMouseLeave],
  );

  useEffect(() => {
    if (props.disabled === true) {
      setHovered(false);
    }
  }, [props.disabled]);

  return (
    <Tooltip title={title}>
      <IconButton
        ref={ref}
        {...rest}
        component="button"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        color={activeColor != undefined ? (hovered ? activeColor : color) : color}
      >
        {activeIcon != undefined ? (hovered ? activeIcon : icon) : icon}
        {children}
      </IconButton>
    </Tooltip>
  );
});

HoverableIconButton.displayName = "HoverableIconButton";

export default HoverableIconButton;
