// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useCallback, useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { scaleValue } from "@foxglove/den/math";
import { toSec } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { subtractTimes } from "@foxglove/studio-base/players/UserScriptPlayer/transformerWorker/typescript/userUtils/time";

export type HoverOverEvent = {
  /** Hovered `fraction` value */
  fraction: number;
  /** Current hovered X position in client coordinates */
  clientX: number;
  /** Current hovered Y position in client coordinates */
  clientY: number;
};

type Props = {
  disabled?: boolean;
  onChange: (value: number) => void;
  onHoverOver?: (event: HoverOverEvent) => void;
  onHoverOut?: () => void;
  cursor: string;
};

const useStyles = makeStyles<{ cursor: string }>()((theme, props) => ({
  root: {
    label: "Slider-root",
    display: "flex",
    width: "100%",
    height: "100%",
    position: "relative",
    alignItems: "center",
    cursor: props.cursor,
  },
  rootDisabled: {
    label: "Slider-rootDisabled",
    cursor: "not-allowed",
    opacity: theme.palette.action.disabledOpacity,
  },
}));

const useRenderSliderStyles = makeStyles()((theme) => ({
  marker: {
    backgroundColor: theme.palette.text.primary,
    position: "absolute",
    height: 16,
    borderRadius: 1,
    width: 2,
    transform: "translate(-50%, 0)",
  },
}));

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;

function RenderSlider() {
  const { classes } = useRenderSliderStyles();

  const startTime = useMessagePipeline(selectStartTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const endTime = useMessagePipeline(selectEndTime);

  const fraction = useMemo(
    () =>
      currentTime && startTime && endTime
        ? toSec(subtractTimes(currentTime, startTime)) / toSec(subtractTimes(endTime, startTime))
        : 0,
    [currentTime, startTime, endTime],
  );

  return <div className={classes.marker} style={{ left: `${fraction * 100}%` }} />;
}

function Slider(props: Props): React.JSX.Element {
  const { disabled = false, onHoverOver, onHoverOut, onChange, cursor } = props;
  const { classes, cx } = useStyles({ cursor });

  const elRef = useRef<HTMLDivElement | ReactNull>(ReactNull);

  const getValueAtMouse = useCallback((ev: React.MouseEvent | MouseEvent): number => {
    if (!elRef.current) {
      return 0;
    }
    const { left, right } = elRef.current.getBoundingClientRect();
    const scaled = scaleValue(ev.clientX, left, right, 0, 1);
    return _.clamp(scaled, 0, 1);
  }, []);

  const [mouseDown, setMouseDown] = useState(false);
  const mouseDownRef = useRef(mouseDown);
  useLayoutEffect(() => {
    mouseDownRef.current = mouseDown;
  }, [mouseDown]);

  const [mouseInside, setMouseInside] = useState(false);
  const mouseInsideRef = useRef(mouseInside);
  useLayoutEffect(() => {
    mouseInsideRef.current = mouseInside;
  }, [mouseInside]);

  const onMouseEnter = useCallback(() => {
    setMouseInside(true);
  }, []);

  const onMouseLeave = useCallback(() => {
    setMouseInside(false);
    if (!mouseDownRef.current) {
      onHoverOut?.();
    }
  }, [onHoverOut]);

  const onPointerUp = useCallback((): void => {
    setMouseDown(false);
    if (!mouseInsideRef.current) {
      onHoverOut?.();
    }
  }, [onHoverOut]);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent | PointerEvent): void => {
      if (mouseDownRef.current && ev.currentTarget !== window) {
        // onPointerMove is used on the <div/> for hovering, and on the window for dragging. While
        // dragging we only want to pay attention to the window events (otherwise we'd be handling
        // each event twice).
        return;
      }
      if (disabled) {
        return;
      }

      const val = getValueAtMouse(ev);
      if (elRef.current) {
        const elRect = elRef.current.getBoundingClientRect();
        onHoverOver?.({
          fraction: val,
          clientX: ev.clientX,
          clientY: elRect.y + elRect.height / 2,
        });
      }
      if (!mouseDownRef.current) {
        return;
      }
      onChange(val);
    },
    [disabled, getValueAtMouse, onChange, onHoverOver],
  );

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled) {
        return;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      ev.preventDefault();
      onChange(getValueAtMouse(ev));
      setMouseDown(true);
    },
    [disabled, getValueAtMouse, onChange],
  );

  useEffect(() => {
    if (mouseDown) {
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointermove", onPointerMove);
      return () => {
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointermove", onPointerMove);
      };
    }
    return undefined;
  }, [mouseDown, onPointerMove, onPointerUp]);

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cx(classes.root, {
        [classes.rootDisabled]: disabled,
      })}
    >
      <RenderSlider />
    </div>
  );
}

export default React.memo(Slider);
