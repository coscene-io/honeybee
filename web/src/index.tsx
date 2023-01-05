// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Provider as RollbarProvider, ErrorBoundary } from "@rollbar/react";
import * as Sentry from "@sentry/browser";
import { BrowserTracing } from "@sentry/tracing";
import { StrictMode } from "react";
import ReactDOM from "react-dom";

import Logger from "@foxglove/log";
import { AppSetting } from "@foxglove/studio-base";
import { bcInstance, LOGOUT_MESSAGE } from "@foxglove/studio-base/util/broadcastChannel";
import { ROLLBAR_CONFIG } from "@foxglove/studio-base/util/rollbarConfig";

import VersionBanner from "./VersionBanner";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

bcInstance.listenBroadcastMessage((msg) => {
  if (msg.data === LOGOUT_MESSAGE) {
    window.location.href = '/login';
  }
});

const log = Logger.getLogger(__filename);

log.debug("initializing");

window.onerror = (...args) => {
  console.error(...args);
};

if (typeof process.env.SENTRY_DSN === "string") {
  log.info("initializing Sentry");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    autoSessionTracking: true,
    // Remove the default breadbrumbs integration - it does not accurately track breadcrumbs and
    // creates more noise than benefit.
    integrations: (integrations) => {
      return integrations
        .filter((integration) => integration.name !== "Breadcrumbs")
        .concat([
          new BrowserTracing({
            startTransactionOnLocationChange: false, // location changes as a result of non-navigation interactions such as seeking
          }),
        ]);
    },
    tracesSampleRate: 0.05,
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element");
}

const isDevelopment = process.env.NODE_ENV === "development";

async function main() {
  const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)\./);
  const chromeVersion = chromeMatch ? parseInt(chromeMatch[1] ?? "", 10) : 0;
  const isChrome = chromeVersion !== 0;

  const canRenderApp = typeof BigInt64Array === "function" && typeof BigUint64Array === "function";
  const banner = (
    <VersionBanner
      isChrome={isChrome}
      currentVersion={chromeVersion}
      isDismissable={canRenderApp}
    />
  );
  const renderCallback = () => {
    // Integration tests look for this console log to indicate the app has rendered once
    log.debug("App rendered");
  };

  if (!canRenderApp) {
    ReactDOM.render(<StrictMode>{banner}</StrictMode>, rootEl, renderCallback);
    return;
  }

  const { installDevtoolsFormatters, overwriteFetch, waitForFonts } = await import(
    "@foxglove/studio-base"
  );
  installDevtoolsFormatters();
  overwriteFetch();
  // consider moving waitForFonts into App to display an app loading screen
  await waitForFonts();

  const { Root } = await import("./Root");

  const appConfiguration = new LocalStorageAppConfiguration({
    defaults: {
      [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
      [AppSetting.HIDE_SIGN_IN_PROMPT]: true,
    },
  });

  ReactDOM.render(
    <StrictMode>
      <RollbarProvider config={ROLLBAR_CONFIG}>
        <ErrorBoundary>
          {banner}
          <Root appConfiguration={appConfiguration} />
        </ErrorBoundary>
      </RollbarProvider>
    </StrictMode>,
    rootEl,
    renderCallback,
  );
}

void main();
