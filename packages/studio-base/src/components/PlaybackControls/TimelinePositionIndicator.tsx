// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CSSProperties, forwardRef } from "react";
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()(() => ({
  root: {
    bottom: 0,
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    transform: "translateX(-50%)",
    width: 9,
  },
  svg: {
    display: "block",
    height: "100%",
    overflow: "visible",
    width: "100%",
  },
}));

export const TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX: number = 10;

function makeDOMRect(x: number, y: number, width: number, height: number): DOMRect {
  if (typeof DOMRect !== "undefined") {
    return new DOMRect(x, y, width, height);
  }

  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  } as DOMRect;
}

export function getTimelinePositionIndicatorHandleAnchorRect(rect: DOMRect): DOMRect {
  return makeDOMRect(
    rect.left + rect.width / 2,
    rect.top + TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX / 2,
    0,
    0,
  );
}

type Props = Omit<HTMLAttributes<HTMLDivElement>, "color"> & {
  color: string;
  dataTestId: string;
  fillOpacity?: number;
  style?: CSSProperties;
};

export const TimelinePositionIndicator: ForwardRefExoticComponent<
  Props & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, Props>(
  function TimelinePositionIndicator(props, ref): React.JSX.Element {
    const { className, color, dataTestId, fillOpacity = 1, style, ...rest } = props;
    const { classes, cx } = useStyles();

    return (
      <div
        {...rest}
        ref={ref}
        className={cx(classes.root, className)}
        data-testid={dataTestId}
        style={{ ...style, color }}
      >
        <svg
          aria-hidden
          className={classes.svg}
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 9 129"
        >
          <path
            d="M9 8.80859L8.72363 8.94727L5 10.8086V128.5L4.99023 128.601C4.94371 128.829 4.74171 129 4.5 129C4.25829 129 4.05629 128.829 4.00977 128.601L4 128.5V10.8086L0.276367 8.94727L0 8.80859V0H9V8.80859ZM1 8.19043L4.5 9.94043L8 8.19043V1H1V8.19043Z"
            fill="currentColor"
            fillOpacity={fillOpacity}
          />
        </svg>
      </div>
    );
  },
);
