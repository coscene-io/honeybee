// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { useCallback, useEffect, useState, useRef } from "react";
import ReactNull from "react";
import { useAsyncFn } from "react-use";

import { ConsoleApi } from "@foxglove/studio-base/index";

import { MAX_PROJECTS_PAGE_SIZE, SCROLL_TOLERANCE } from "./constants";

// Timer hook
export function useTimer() {
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout>();

  const formatElapsedTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }, []);

  const startTimer = useCallback(() => {
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    setElapsedTime(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    elapsedTime,
    formatElapsedTime,
    startTimer,
    stopTimer,
  };
}

// Log management hook
export function useLogManager() {
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(ReactNull);
  const [isUserScrolling, setIsUserScrolling] = useState<boolean>(false);

  const addLog = useCallback(
    (newLog: string) => {
      setLogs((prevLogs) => [...prevLogs, newLog]);
    },
    [setLogs],
  );

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (logContainerRef.current && !isUserScrolling) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [isUserScrolling]);

  // 检测用户是否手动滚动
  const handleScroll = useCallback(() => {
    if (logContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_TOLERANCE;
      setIsUserScrolling(!isAtBottom);
    }
  }, []);

  // 当日志更新时自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  return {
    logs,
    logContainerRef,
    addLog,
    handleScroll,
  };
}

// Project data management hook
export function useProjectData(consoleApi: ConsoleApi, userInfo: { userId: string }) {
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);
  const [recordLabelOptions, setRecordLabelOptions] = useState<Label[]>([]);

  // 获取项目列表
  const [, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo.userId;

    if (userId) {
      try {
        return await consoleApi.listUserProjects({
          userId,
          pageSize: MAX_PROJECTS_PAGE_SIZE,
          currentPage: 0,
        });
      } catch (error) {
        console.error("error", error);
      }
    }

    return undefined;
  }, [consoleApi, userInfo.userId]);

  // 获取标签列表
  const [, syncRecordLabels] = useAsyncFn(
    async (projectName: string) => {
      if (projectName) {
        try {
          const listLabelsResponse = await consoleApi.listLabels({
            warehouseId: projectName.split("warehouses/")[1]?.split("/")[0] ?? "",
            projectId: projectName.split("/").pop() ?? "",
            pageSize: MAX_PROJECTS_PAGE_SIZE,
          });
          const labels = listLabelsResponse.labels;
          setRecordLabelOptions(labels);
          return listLabelsResponse;
        } catch (error) {
          console.error("error", error);
        }
      }

      return undefined;
    },
    [consoleApi],
  );

  return {
    projectOptions,
    setProjectOptions,
    recordLabelOptions,
    setRecordLabelOptions,
    syncProjects,
    syncRecordLabels,
  };
}
