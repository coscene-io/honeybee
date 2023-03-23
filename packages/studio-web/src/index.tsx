// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Sentry from "@sentry/browser";
import { BrowserTracing } from "@sentry/tracing";
import { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom";

import Logger from "@foxglove/log";
import { CoSceneIDataSourceFactory } from "@foxglove/studio-base";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { bcInstance, LOGOUT_MESSAGE } from "@foxglove/studio-base/util/broadcastChannel";
import __browserLogger from "@foxglove/studio-base/util/browserLogger";

import VersionBanner from "./VersionBanner";

const log = Logger.getLogger(__filename);

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, no-underscore-dangle
export const __bl = __browserLogger.__bl || {};

function LogAfterRender(props: React.PropsWithChildren<unknown>): JSX.Element {
  useEffect(() => {
    // Integration tests look for this console log to indicate the app has rendered once
    const level = log.getLevel();
    log.setLevel("debug");
    log.debug("App rendered");
    log.setLevel(level);
  }, []);
  return <>{props.children}</>;
}

type MainParams = {
  dataSources?: CoSceneIDataSourceFactory[];
  extraProviders?: JSX.Element[];
};

export async function main(params: MainParams = {}): Promise<void> {
  log.debug("initializing");

  bcInstance.listenBroadcastMessage((msg) => {
    if (msg === LOGOUT_MESSAGE) {
      window.location.href = "/login";
    }
  });

  window.onerror = (...args) => {
    console.error(...args);
  };

  if (APP_CONFIG.VITE_APP_PROJECT_ENV !== "local") {
    log.info("initializing Sentry");
    Sentry.init({
      dsn: APP_CONFIG.SENTRY_HONEYBEE_DSN,
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
      environment: APP_CONFIG.VITE_APP_PROJECT_ENV,

      // We recommend adjusting this value in production, or using tracesSampler
      // for finer control
      tracesSampleRate: 1.0,
    });
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("missing #root element");
  }

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

  if (!canRenderApp) {
    ReactDOM.render(
      <StrictMode>
        <LogAfterRender>{banner}</LogAfterRender>
      </StrictMode>,
      rootEl,
    );
    return;
  }

  const { installDevtoolsFormatters, overwriteFetch, waitForFonts, initI18n } = await import(
    "@foxglove/studio-base"
  );
  installDevtoolsFormatters();
  overwriteFetch();
  // consider moving waitForFonts into App to display an app loading screen
  await waitForFonts();
  await initI18n();

  const { Root } = await import("./Root");

  ReactDOM.render(
    <StrictMode>
      <LogAfterRender>
        {banner}
        <Root extraProviders={params.extraProviders} dataSources={params.dataSources} />
      </LogAfterRender>
    </StrictMode>,
    rootEl,
  );
}
