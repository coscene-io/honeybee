import { Configuration } from "rollbar";

export const ROLLBAR_CONFIG: Configuration = {
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
  captureUncaught: true,
  captureUnhandledRejections: true,
  enabled: window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1",
  payload: {
    environment: process.env.PROJECT_ENV,
    host: window.location.hostname,
    client: {
      javascript: {
        code_version: process.env.NPM_PACKAGE_VERSION ?? "0.0.1",
        source_map_enabled: true,
      },
    },
  },
};
