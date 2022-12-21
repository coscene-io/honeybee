declare global {
  interface Window {
    cosConfig: {
      VITE_APP_BASE_API_PORT?: string;
      VITE_APP_BASE_API_URL?: string;
      VITE_APP_PROJECT_ENV?: string;
      VITE_APP_ROLLBAR_ACCESS_TOKEN?: string;
      VITE_APP_IMAGE_TAG?: string;
      CS_HONEYBEE_BASE_URL?: string;
    };
  }
}

const cosConfig = window.cosConfig ?? {};
export const APP_CONFIG = {
  VITE_APP_BASE_API_PORT:
    cosConfig.VITE_APP_BASE_API_PORT ?? process.env.VITE_APP_BASE_API_PORT ?? "443",
  VITE_APP_BASE_API_URL:
    cosConfig.VITE_APP_BASE_API_URL ??
    process.env.VITE_APP_BASE_API_URL ??
    "https://api.coscene.dev",
  VITE_APP_PROJECT_ENV:
    cosConfig.VITE_APP_PROJECT_ENV ?? process.env.VITE_APP_PROJECT_ENV ?? "local",
  VITE_APP_ROLLBAR_ACCESS_TOKEN: cosConfig.VITE_APP_ROLLBAR_ACCESS_TOKEN ?? "",
  CS_HONEYBEE_BASE_URL:
    cosConfig.CS_HONEYBEE_BASE_URL ?? process.env.CS_HONEYBEE_BASE_URL ?? "http://localhost:8080",
  LAST_BUILD_TIME: process.env.LAST_BUILD_TIME,
  NPM_PACKAGE_VERSION: process.env.NPM_PACKAGE_VERSION,
};

window.cosConfig = APP_CONFIG;
