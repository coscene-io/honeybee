// Service utilities for FaultRecord panel
import type { PanelExtensionContext } from "@foxglove/studio";
import { ActionNameConfig, ActionInfo } from "./types";

/**
 * Call ROS2 service to get action list and filter with is_enable = true.
 * Type assertion is required because context.callService returns unknown.
 */
export async function fetchActionList(
  context: PanelExtensionContext,
  serviceName: string = "/RecordPlayback/GetActionList",
): Promise<ActionInfo[]> {
  if (!context) {
    // eslint-disable-next-line no-console
    console.error("fetchActionList: context is undefined");
    return [];
  }
  try {
    if (typeof context.callService === "function") {
      const rsp = (await context.callService(serviceName, { mode: "all" })) as {
        actions?: ActionInfo[];
      };
      const actions: ActionInfo[] = Array.isArray(rsp?.actions) ? rsp.actions! : [];
      return actions.filter((a) => a?.is_enable === true);
    }
    // eslint-disable-next-line no-console
    console.warn("fetchActionList: context.callService is not available, returning empty list");
    return [];
  } catch (err) {
    // eslint-disable-next-line no-console
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