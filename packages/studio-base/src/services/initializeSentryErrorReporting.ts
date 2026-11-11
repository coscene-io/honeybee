// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Sentry from "@sentry/browser";

import Logger from "@foxglove/log";
import { setReportErrorHandler } from "@foxglove/studio-base/reportError";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger(__filename);

export function initializeSentryErrorReporting(appConfig: ReturnType<typeof getAppConfig>): void {
  if (
    appConfig.VITE_APP_PROJECT_ENV === "local" ||
    appConfig.VITE_APP_PROJECT_ENV === "aws" ||
    appConfig.VITE_APP_PROJECT_ENV === "gcp" ||
    appConfig.SENTRY_ENABLED !== true
  ) {
    // Stop explicit boundary forwarding. The existing SDK initialization/shutdown policy is
    // unchanged; this does not close an already initialized SDK client.
    setReportErrorHandler(undefined);
    return;
  }

  log.info("initializing Sentry");
  Sentry.init({
    dsn: appConfig.SENTRY_HONEYBEE_DSN,
    release: appConfig.RELEASE_TAG,
    autoSessionTracking: true,
    // Remove the default breadcrumbs integration - it does not accurately track breadcrumbs and
    // creates more noise than benefit.
    integrations: (integrations) => {
      return integrations
        .filter((integration) => integration.name !== "Breadcrumbs")
        .concat([
          Sentry.browserTracingIntegration({
            instrumentNavigation: false,
          }),
        ]);
    },
    environment: appConfig.VITE_APP_PROJECT_ENV,
    tracesSampleRate: 0.1,
  });

  // React 19 does not rethrow errors caught by a boundary. Report those explicitly while retaining
  // Sentry's default global handling for uncaught errors, without adding a second onCaughtError hook.
  setReportErrorHandler((error, errorInfo) => {
    Sentry.captureException(error, {
      contexts: errorInfo ? { react: { componentStack: errorInfo.componentStack } } : undefined,
    });
  });
}
