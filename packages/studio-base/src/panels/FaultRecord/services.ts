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
  context: PanelExtensionContext,
  serviceName: string = "/recordbag_5Fmsgs/srv/GetActionList",
  retryCount = 0,
): Promise<ActionInfo[]> {
  const maxRetries = 3;
  const retryDelay = 2000; // 2秒

  if (context == undefined) {
    console.error("fetchActionList: context is undefined");
    return [];
  }
  try {
    if (typeof context.callService === "function") {
      const rsp = (await context.callService(serviceName, {})) as {
        actions?: ActionInfo[];
      };
      const actions: ActionInfo[] = Array.isArray(rsp.actions) ? rsp.actions : [];
      return actions.filter((a) => a.is_enable);
    }

    console.warn("fetchActionList: context.callService is not available, returning empty list");
    return [];
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 检查是否是服务未启动的错误
    if (errorMessage.includes("has not been advertised") && retryCount < maxRetries) {
      console.warn(
        `fetchActionList: ROS服务未启动，${retryDelay / 1000}秒后重试 (${
          retryCount + 1
        }/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return await fetchActionList(context, serviceName, retryCount + 1);
    }

    console.error("Failed to call GetActionList:", err);
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
