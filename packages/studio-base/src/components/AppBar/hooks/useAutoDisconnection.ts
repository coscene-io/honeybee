// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// 100 年 disable timeout
const TIMEOUT_DISABLED = Number.MAX_SAFE_INTEGER;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keypress",
  "touchmove",
  "scroll", // 添加滚动事件
  "wheel", // 添加滚轮事件
  "pointermove", // 添加指针移动事件
  "pointerdown", // 添加指针按下事件
];

const selectClose = (ctx: MessagePipelineContext) => ctx.close;
const selectReOpen = (ctx: MessagePipelineContext) => ctx.reOpen;

export function useAutoDisconnection({
  confirm,
  foregroundTimeout,
  backgroundTimeout,
}: {
  confirm: confirmTypes;
  foregroundTimeout: number;
  backgroundTimeout: number;
}): number {
  const [inactiveTimeout, setInactiveTimeout] = useState<number>(foregroundTimeout);
  const [isDisableTimeout, setIsDisableTimeout] = useState<boolean>(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | undefined>(undefined);
  const [remainingTime, setRemainingTime] = useState<number>(inactiveTimeout);
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());

  const { t } = useTranslation("cosWebsocket");

  const close = useMessagePipeline(selectClose);
  const reOpen = useMessagePipeline(selectReOpen);

  const resetTimer = useCallback(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const currentTime = Date.now();
    setLastActivityTime(currentTime);

    setTimeoutId(
      setTimeout(() => {
        try {
          close();
          void confirm({
            title: t("note"),
            prompt: t("inactivePageDescription"),
            ok: t("reconnect"),
            cancel: t("cancel"),
          }).then((result) => {
            if (result === "ok") {
              reOpen();
            } else {
              window.close();
            }
          });
        } catch (error) {
          console.error("Error during disconnection:", error);
        }
      }, inactiveTimeout),
    );
  }, [timeoutId, inactiveTimeout, close, confirm, t, reOpen]);

  // 使用 useEffect 处理倒计时更新
  useEffect(() => {
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
  }, [lastActivityTime, inactiveTimeout]);

  const resetInactiveTimeout = useCallback(() => {
    if (isDisableTimeout) {
      return;
    }

    if (document.visibilityState === "visible") {
      setInactiveTimeout(foregroundTimeout);
    } else {
      setInactiveTimeout(backgroundTimeout);
    }
    resetTimer();
  }, [isDisableTimeout, foregroundTimeout, backgroundTimeout, resetTimer]);

  const throttledResetTimer = useMemo(() => _.throttle(resetTimer, 1000), [resetTimer]);

  const addEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, throttledResetTimer);
    });
    window.addEventListener("visibilitychange", resetInactiveTimeout);
  }, [throttledResetTimer, resetInactiveTimeout]);

  const removeEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.removeEventListener(event, throttledResetTimer);
    });
    window.removeEventListener("visibilitychange", resetInactiveTimeout);
  }, [throttledResetTimer, resetInactiveTimeout]);

  useEffect(() => {
    const disableTimeout = localStorage.getItem("disable_timeout") === "true";
    setIsDisableTimeout(disableTimeout);
    if (disableTimeout) {
      setInactiveTimeout(TIMEOUT_DISABLED);
    }

    addEventListener();
    return () => {
      removeEventListener();
    };
  }, [addEventListener, removeEventListener]);

  return remainingTime;
}
