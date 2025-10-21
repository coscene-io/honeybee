// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Service utilities for FaultRecord panel
import type { PanelExtensionContext } from "@foxglove/studio";

import { ActionNameConfig, ActionInfo } from "./types";

/**
 * Call ROS2 service to get action list and filter with is_enable = true.
 * Type assertion is required because context.callService returns unknown.
 */
export async function fetchActionList(
  context: PanelExtensionContext | undefined,
  serviceName: string = "/record_5Fplayback_5Fmsgs/srv/GetActionList",
  retryCount = 0,
): Promise<ActionInfo[]> {
  const maxRetries = 1; // 减少重试次数
  const retryDelay = 1000; // 减少延迟到1秒

  console.debug(
    `[FaultRecord] fetchActionList called with serviceName: ${serviceName}, retryCount: ${retryCount}`,
  );

  if (context == undefined) {
    console.warn(`[FaultRecord] fetchActionList: context is undefined`);
    return [];
  }
  try {
    if (typeof context.callService === "function") {
      console.debug(`[FaultRecord] Calling service: ${serviceName}`);
      const rsp = (await context.callService(serviceName, {})) as {
        actions?: ActionInfo[];
      };
      console.debug(`[FaultRecord] Service response:`, rsp);
      const actions: ActionInfo[] = Array.isArray(rsp.actions) ? rsp.actions : [];
      const filteredActions = actions.filter((a) => a.is_enable);
      console.debug(
        `[FaultRecord] Total actions: ${actions.length}, filtered actions: ${filteredActions.length}`,
      );
      return filteredActions;
    }

    console.warn(`[FaultRecord] fetchActionList: context.callService is not a function`);
    return [];
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 只在第一次失败时打印错误日志
    if (retryCount === 0) {
      console.error(`[FaultRecord] fetchActionList failed: ${errorMessage}`);
    }

    // 检查是否是服务未启动的错误
    if (errorMessage.includes("has not been advertised") && retryCount < maxRetries) {
      console.debug(
        `[FaultRecord] Service not advertised, retrying in ${retryDelay}ms (attempt ${
          retryCount + 1
        }/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return await fetchActionList(context, serviceName, retryCount + 1);
    }
    return [];
  }
}

/**
 * Get available action names for dropdown.
 */
export async function fetchAvailableActions(
  context: PanelExtensionContext,
  serviceName?: string,
): Promise<ActionNameConfig[]> {
  const actions = await fetchActionList(context, serviceName);
  return actions.map((a) => ({ value: a.action_name, label: a.action_name }));
}

/**
 * Get available actions with full info for display.
 */
export async function fetchAvailableActionsWithInfo(
  context: PanelExtensionContext,
  serviceName?: string,
): Promise<ActionInfo[]> {
  return await fetchActionList(context, serviceName);
}

/**
 * Refresh action names; fallback handled inside fetchActionList.
 */
export async function refreshActionNames(
  context: PanelExtensionContext,
  serviceName?: string,
): Promise<ActionNameConfig[]> {
  return await fetchAvailableActions(context, serviceName);
}

/**
 * Check if an action is available (is_enable = true in current list).
 */
export async function isActionAvailable(
  context: PanelExtensionContext,
  actionName: string,
  serviceName?: string,
): Promise<boolean> {
  const availableActions = await fetchAvailableActions(context, serviceName);
  return availableActions.some((a) => a.value === actionName);
}

/**
 * Get detailed information for a specific action by name.
 */
export async function getActionDetail(
  actionName: string,
  context: PanelExtensionContext,
  serviceName?: string,
): Promise<ActionInfo | undefined> {
  const actions = await fetchActionList(context, serviceName);
  return actions.find((action) => action.action_name === actionName);
}
