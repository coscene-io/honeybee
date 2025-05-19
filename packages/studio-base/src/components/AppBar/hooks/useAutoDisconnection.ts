// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";

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
const selectDataSource = (state: CoSceneBaseStore) => state.dataSource;

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
  const [remainingTime, setRemainingTime] = useState<number>(inactiveTimeout);
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());

  // 使用 useRef 替代 useState 来管理 timeoutId
  const timeoutRef = useRef<NodeJS.Timeout>();

  const { t } = useTranslation("cosWebsocket");
  const dataSource = useBaseInfo(selectDataSource);
  const close = useMessagePipeline(selectClose);
  const reOpen = useMessagePipeline(selectReOpen);

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
        close();
        removeEventListener();
        void confirm({
          title: t("vizIsDisconnected"),
          prompt: t("inactivePageDescription", { time: remainingTime / 1000 / 60 }),
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
            console.error("Error during confirmation:", error);
          });
      } catch (error) {
        console.error("Error during disconnection:", error);
      }
    }, timeout);

    // 更新 ref 的值
    timeoutRef.current = inactiveTimeoutId;
  }, [inactiveTimeout, close, confirm, t, reOpen]);

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

  const throttledResetTimer = useMemo(() => _.throttle(resetTimer, 1000), [resetTimer]);

  const addEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, throttledResetTimer);
    });
  }, []);

  const removeEventListener = useCallback(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.removeEventListener(event, throttledResetTimer);
    });
  }, []);

  useEffect(() => {
    const disableTimeout = localStorage.getItem("disable_timeout") === "true";
    if (disableTimeout || (dataSource && dataSource.id !== "coscene-websocket")) {
      setInactiveTimeout(TIMEOUT_DISABLED);
      return;
    }

    addEventListener();
    throttledResetTimer();
    return () => {
      removeEventListener();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return remainingTime;
}
