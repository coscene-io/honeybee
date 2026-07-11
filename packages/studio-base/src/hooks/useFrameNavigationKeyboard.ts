// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";

export type KeyHandlers = Record<string, (event: KeyboardEvent) => void | boolean | undefined>;

type UseFrameNavigationKeyboardArgs = {
  readonly onPreviousFrame: () => void;
  readonly onNextFrame: () => void;
};

function panelContainsFocus(panelRef: RefObject<HTMLDivElement | ReactNull>): boolean {
  return (
    panelRef.current != undefined &&
    document.activeElement != undefined &&
    panelRef.current.contains(document.activeElement)
  );
}

export function useFrameNavigationKeyboard(args: UseFrameNavigationKeyboardArgs): {
  readonly panelRef: RefObject<HTMLDivElement | ReactNull>;
  readonly keyDownHandlers: KeyHandlers;
  readonly keyUpHandlers: KeyHandlers;
} {
  const panelRef = useRef<HTMLDivElement>(ReactNull);
  const keyRepeatState = useRef<{
    key: string | undefined;
    timeoutId: NodeJS.Timeout | undefined;
    intervalId: NodeJS.Timeout | undefined;
  }>({
    key: undefined,
    timeoutId: undefined,
    intervalId: undefined,
  });

  const clearRepeatTimers = useCallback(() => {
    if (keyRepeatState.current.timeoutId != undefined) {
      clearTimeout(keyRepeatState.current.timeoutId);
      keyRepeatState.current.timeoutId = undefined;
    }
    if (keyRepeatState.current.intervalId != undefined) {
      clearInterval(keyRepeatState.current.intervalId);
      keyRepeatState.current.intervalId = undefined;
    }
    keyRepeatState.current.key = undefined;
  }, []);

  const executeFrameAction = useCallback(
    (key: string) => {
      switch (key) {
        case "ArrowUp":
          args.onPreviousFrame();
          break;
        case "ArrowDown":
          args.onNextFrame();
          break;
        default:
          break;
      }
    },
    [args],
  );

  const startRepeatExecution = useCallback(
    (key: string) => {
      executeFrameAction(key);
      keyRepeatState.current.timeoutId = setTimeout(() => {
        keyRepeatState.current.intervalId = setInterval(() => {
          executeFrameAction(key);
        }, 150);
      }, 400);
    },
    [executeFrameAction],
  );

  const keyDownHandlers = useMemo(
    (): KeyHandlers => ({
      ArrowUp: () => {
        if (!panelContainsFocus(panelRef)) {
          return false;
        }
        if (keyRepeatState.current.key === "ArrowUp") {
          return true;
        }
        clearRepeatTimers();
        keyRepeatState.current.key = "ArrowUp";
        startRepeatExecution("ArrowUp");
        return true;
      },
      ArrowDown: () => {
        if (!panelContainsFocus(panelRef)) {
          return false;
        }
        if (keyRepeatState.current.key === "ArrowDown") {
          return true;
        }
        clearRepeatTimers();
        keyRepeatState.current.key = "ArrowDown";
        startRepeatExecution("ArrowDown");
        return true;
      },
    }),
    [clearRepeatTimers, startRepeatExecution],
  );

  const keyUpHandlers = useMemo(
    (): KeyHandlers => ({
      ArrowUp: () => {
        if (!panelContainsFocus(panelRef)) {
          return false;
        }
        if (keyRepeatState.current.key === "ArrowUp") {
          clearRepeatTimers();
        }
        return true;
      },
      ArrowDown: () => {
        if (!panelContainsFocus(panelRef)) {
          return false;
        }
        if (keyRepeatState.current.key === "ArrowDown") {
          clearRepeatTimers();
        }
        return true;
      },
    }),
    [clearRepeatTimers],
  );

  useEffect(() => {
    return () => {
      clearRepeatTimers();
    };
  }, [clearRepeatTimers]);

  return { panelRef, keyDownHandlers, keyUpHandlers };
}
