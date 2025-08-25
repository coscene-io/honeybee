import type { SettingsTreeAction, SettingsTreeNode } from "@coscene/extension";
import type { Config, ServiceConfig } from "./types";

// 默认配置
export const defaultConfig: Config = {
  services: [
    {
      displayName: "结束测试并获取候选文件",
      serviceName: "/end_test_and_get_files",
    },
    {
      displayName: "重置",
      serviceName: "/reset_upload_panel",
    },
  ],
};

// 处理设置树更新动作
export function settingsActionReducer(config: Config, action: SettingsTreeAction): Config {
  // 处理重置操作 - 当用户点击"重置默认值"时
  if (action.action === "perform-node-action" && action.payload.id === "reset") {
    return { ...defaultConfig };
  }
  
  // 处理字段更新
  if (action.action === "update" && action.payload.path && action.payload.value !== undefined) {
    const newConfig = { ...config };
    const pathArray = Array.isArray(action.payload.path) ? action.payload.path : [action.payload.path];
    const pathStr = pathArray.join(".");
    const value = action.payload.value;
    
    // 处理服务配置更新
    if (pathStr.startsWith("general.service-")) {
      const match = pathStr.match(/^general\.service-(\d+)\.(displayName|serviceName)$/);
      if (match) {
        const index = parseInt(match[1]);
        const field = match[2] as keyof ServiceConfig;
        
        newConfig.services = [...config.services];
        if (newConfig.services[index]) {
          newConfig.services[index] = {
            ...newConfig.services[index],
            [field]: value,
          };
        }
      }
    }
    
    return newConfig;
  }
  
  return config;
}

// 生成设置树节点
export function useSettingsNodes(config: Config, actionHandler?: (action: SettingsTreeAction) => void): Record<string, any> {
  const serviceNodes: Record<string, any> = {};
  
  // 为每个服务生成配置节点
  config.services.forEach((service, index) => {
    serviceNodes[`service-${index}`] = {
      label: `${service.displayName}`,
      icon: "Settings",
      handler: actionHandler,
      fields: {
        displayName: {
          label: "显示名称",
          input: "string",
          value: service.displayName,
          placeholder: "输入按钮显示的中文名称",
          help: "在面板中显示的按钮文字",
        },
        serviceName: {
          label: "ROS服务名",
          input: "string",
          value: service.serviceName,
          placeholder: "输入ROS服务名称",
          help: "实际调用的ROS服务名称",
        },
      },
    };
  });
  
  return {
    general: {
      label: "文件上传服务配置",
      icon: "Settings",
      handler: actionHandler,
      children: serviceNodes,
      actions: [
        {
          type: "action",
          id: "reset",
          label: "重置默认值",
          icon: "Reset",
        },
      ],
    },
  };
}