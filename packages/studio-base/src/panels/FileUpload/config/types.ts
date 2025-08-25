export interface ServiceConfig {
  displayName: string;
  serviceName: string;
}

export interface Config {
  services: ServiceConfig[];
}