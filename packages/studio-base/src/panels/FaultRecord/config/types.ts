export interface ServiceConfig {
  displayName: string;  // 按钮显示的中文名称
  serviceName: string;  // ROS服务名称
}

export interface Config {
  services: ServiceConfig[];  // 改为数组支持动态增删
}