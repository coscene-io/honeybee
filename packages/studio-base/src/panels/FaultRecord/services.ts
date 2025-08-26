import { ActionNameConfig } from "./types";

// Mock数据 - 模拟从ROS2获取的action name列表
const MOCK_ACTION_NAMES: ActionNameConfig[] = [
  { value: "move_to_position", label: "Move to Position" },
  { value: "pick_object", label: "Pick Object" },
  { value: "place_object", label: "Place Object" },
  { value: "navigate_to_goal", label: "Navigate to Goal" },
  { value: "scan_environment", label: "Scan Environment" },
];

/**
 * 获取可用的action name列表
 * TODO: 替换为实际的ROS2 action调用
 * @returns Promise<ActionNameConfig[]> action name列表
 */
export async function fetchAvailableActions(): Promise<ActionNameConfig[]> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // TODO: 在这里实现实际的ROS2 action调用
  // 例如：
  // const response = await ros2Client.callAction('get_available_actions', {});
  // return response.action_names.map(name => ({ value: name, label: name }));
  
  return MOCK_ACTION_NAMES;
}

/**
 * 刷新action name列表
 * 这个函数可以在需要时被调用来重新获取最新的action列表
 */
export async function refreshActionNames(): Promise<ActionNameConfig[]> {
  try {
    return await fetchAvailableActions();
  } catch (error) {
    console.error('Failed to fetch action names:', error);
    // 返回默认的action列表作为fallback
    return MOCK_ACTION_NAMES;
  }
}

/**
 * 检查指定的action name是否可用
 * @param actionName 要检查的action name
 * @returns Promise<boolean> 是否可用
 */
export async function isActionAvailable(actionName: string): Promise<boolean> {
  try {
    const availableActions = await fetchAvailableActions();
    return availableActions.some(action => action.value === actionName);
  } catch (error) {
    console.error('Failed to check action availability:', error);
    return false;
  }
}