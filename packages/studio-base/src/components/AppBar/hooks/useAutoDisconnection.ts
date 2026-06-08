// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import Log from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

const log = Log.getLogger(__filename);

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const TIMEOUT_DISABLED = 1000 * 60 * 60 * 24 * 365 * 100;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keypress",
  "touchmove",
  "scroll", // 添加滚动事件
  "wheel", // 添加滚轮事件
  "pointermove", // 添加指针移动事件
  "pointerdown", // 添加指针按下事件
  "visibilitychange",
];

const selectClose = (ctx: MessagePipelineContext) => ctx.close;
const selectReOpen = (ctx: MessagePipelineContext) => ctx.reOpen;
const selectPlayer = (ctx: MessagePipelineContext) => ctx.playerState;

export function useAutoDisconnection({
  confirm,
  foregroundTimeout,
  backgroundTimeout,
  disableTimeout,
}: {
  confirm: confirmTypes;
  foregroundTimeout: number;
  backgroundTimeout: number;
  disableTimeout: boolean;
}): number {
  const [inactiveTimeout, setInactiveTimeout] = useState<number>(foregroundTimeout);
  const [remainingTime, setRemainingTime] = useState<number>(inactiveTimeout);
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());

  // 使用 useRef 替代 useState 来管理 timeoutId
  const timeoutRef = useRef<NodeJS.Timeout>();

  const { t } = useTranslation("websocket");
  const close = useMessagePipeline(selectClose);
  const reOpen = useMessagePipeline(selectReOpen);
  const playerState = useMessagePipeline(selectPlayer);

  const resetTimer = useCallback(() => {
    // 清除旧的 timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const currentTime = Date.now();
    setLastActivityTime(currentTime);

    const timeout = document.visibilityState === "visible" ? foregroundTimeout : backgroundTimeout;
    setInactiveTimeout(timeout);

    const inactiveTimeoutId = setTimeout(() => {
      try {
        log.debug("close connection start");

        // check is player presence is not present, if not present, skip close call
        if (playerState.presence === PlayerPresence.NOT_PRESENT) {
          log.debug("Player already disconnected, skipping close call");
          return;
        }

        if (typeof close === "function") {
          close();
        } else {
          log.error("close is not a function:", close);
        }
        removeEventListener();
        void confirm({
          title: t("vizIsDisconnected"),
          prompt: t("inactivePageDescription", { time: inactiveTimeout / 1000 / 60 }),
          ok: t("reconnect"),
          cancel: t("exitAndClosePage"),
        })
          .then((result) => {
            if (result === "ok") {
              addEventListener();
              reOpen();
            } else {
              window.close();
            }
          })
          .catch((error: unknown) => {
            log.error("Error during confirmation:", error);
          });
      } catch (error) {
        log.error("Error during disconnection:", error);
      }
    }, timeout);

    // 更新 ref 的值
    timeoutRef.current = inactiveTimeoutId;
  }, [
    inactiveTimeout,
    close,
    confirm,
    t,
    reOpen,
    playerState.presence,
    foregroundTimeout,
    backgroundTimeout,
  ]);

  // 使用 useEffect 处理倒计时更新
  useEffect(() => {
    if (disableTimeout) {
      return;
    }

    let timer: NodeJS.Timeout;

    const updateRemainingTime = () => {
      const elapsed = Date.now() - lastActivityTime;
      setRemainingTime(Math.max(0, inactiveTimeout - elapsed));
      timer = setTimeout(updateRemainingTime, 1000);
    };

    updateRemainingTime();

    return () => {
      clearTimeout(timer);
    };
  }, [lastActivityTime, inactiveTimeout, disableTimeout]);

  const throttledResetTimer = useMemo(() => _.throttle(resetTimer, 1000), [resetTimer]);

  const addEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, throttledResetTimer);
    });
  }, [throttledResetTimer]);

  const removeEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.removeEventListener(event, throttledResetTimer);
    });
  }, [throttledResetTimer]);

  useEffect(() => {
    if (disableTimeout) {
      setInactiveTimeout(TIMEOUT_DISABLED);
      return;
    }

    addEventListener();
    throttledResetTimer();
    return () => {
      removeEventListener();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };
  }, [disableTimeout, addEventListener, removeEventListener, throttledResetTimer]);

  // 当 player 状态改变时，如果变为 NOT_PRESENT，清除当前的 timeout
  useEffect(() => {
    if (playerState.presence === PlayerPresence.NOT_PRESENT && timeoutRef.current) {
      log.debug("Player disconnected, clearing auto-disconnect timeout");
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, [playerState.presence]);

  return remainingTime;
}
