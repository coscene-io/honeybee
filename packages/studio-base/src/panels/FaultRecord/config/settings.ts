import type { SettingsTreeAction, SettingsTreeNode } from "@coscene/extension";
import type { Config, ServiceConfig } from "./types";

// 默认配置
export const defaultConfig: Config = {
  services: [
    {
      displayName: "记录故障点",
      serviceName: "/mark_fault",
    },
    {
      displayName: "记录异常",
      serviceName: "/mark_exception",
    },
    {
      displayName: "记录维护",
      serviceName: "/mark_maintenance",
    },
  ],
};

// 处理设置树更新动作
export function settingsActionReducer(config: Config, action: SettingsTreeAction): Config {
  // 处理字段更新
  if (action.action === "update" && action.payload.path && action.payload.value !== undefined) {
    const newConfig = { ...config };
    const pathArray = Array.isArray(action.payload.path) ? action.payload.path : [action.payload.path];
    const pathStr = pathArray.join(".");
    const value = action.payload.value;
    
    // 处理添加服务操作 - 使用特殊字符串值触发
    if (pathStr === "general.addServiceAction" && value === "add-new-service") {
      return {
        ...config,
        services: [
          ...config.services,
          {
            displayName: "新服务",
            serviceName: "/new_service",
          },
        ],
      };
    }
    
    // 处理删除服务操作 - 使用特殊字符串值触发
    const deleteMatch = pathStr.match(/^general\.service-(\d+)\.deleteAction$/);
    if (deleteMatch && value === "delete-service") {
      const index = parseInt(deleteMatch[1]);
      if (config.services.length > 1 && index >= 0 && index < config.services.length) {
        return {
          ...config,
          services: config.services.filter((_, i) => i !== index),
        };
      }
    }
    
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
      label: `服务 ${index + 1}: ${service.displayName}`,
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
          placeholder: "输入ROS服务名称，如：/mark_fault",
          help: "实际调用的ROS服务名称",
        },
        // 只有多个服务时才显示删除操作
        ...(config.services.length > 1 ? {
          deleteAction: {
            label: "删除操作",
            input: "select",
            value: "",
            options: [
              { label: "选择操作...", value: "" },
              { label: "删除此服务", value: "delete-service" },
            ],
            help: "选择删除此服务配置",
          },
        } : {}),
      },
    };
  });
  
  return {
    general: {
      label: "故障记录服务配置",
      icon: "Settings",
      handler: actionHandler,
      fields: {
        addServiceAction: {
          label: "添加服务操作",
          input: "select",
          value: "",
          options: [
            { label: "选择操作...", value: "" },
            { label: "添加新服务", value: "add-new-service" },
          ],
          help: "选择添加新的服务配置",
        },
      },
      children: serviceNodes,
    },
  };
}