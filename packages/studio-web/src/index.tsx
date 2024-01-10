// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import * as Sentry from "@sentry/browser";
import { BrowserTracing } from "@sentry/tracing";
import { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom";

import Logger from "@foxglove/log";
import type { CoSceneIDataSourceFactory } from "@foxglove/studio-base";
import CssBaseline from "@foxglove/studio-base/components/CssBaseline";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { bcInstance, LOGOUT_MESSAGE } from "@foxglove/studio-base/util/broadcastChannel";

import { CompatibilityBanner } from "./CompatibilityBanner";
import { canRenderApp } from "./canRenderApp";

const log = Logger.getLogger(__filename);

function LogAfterRender(props: React.PropsWithChildren): JSX.Element {
  useEffect(() => {
    // Integration tests look for this console log to indicate the app has rendered once
    // We use console.debug to bypass our logging library which hides some log levels in prod builds
    console.debug("App rendered");
  }, []);
  return <>{props.children}</>;
}

export type MainParams = {
  dataSources?: CoSceneIDataSourceFactory[];
  extraProviders?: JSX.Element[];
  rootElement?: JSX.Element;
};

export async function main(getParams: () => Promise<MainParams> = async () => ({})): Promise<void> {
  log.debug("initializing");

  bcInstance.listenBroadcastMessage((msg) => {
    if (msg === LOGOUT_MESSAGE) {
      window.location.href = "/login";
    }
  });

  window.onerror = (...args) => {
    console.error(...args);
  };

  if (APP_CONFIG.VITE_APP_PROJECT_ENV !== "local" && APP_CONFIG.SENTRY_ENABLED) {
    log.info("initializing Sentry");
    Sentry.init({
      dsn: APP_CONFIG.SENTRY_HONEYBEE_DSN,
      release: APP_CONFIG.RELEASE_TAG,
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
      tracesSampleRate: 0.1,
    });
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("missing #root element");
  }

  const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)\./);
  const chromeVersion = chromeMatch ? parseInt(chromeMatch[1] ?? "", 10) : 0;
  const isChrome = chromeVersion !== 0;

  const canRender = canRenderApp();
  const banner = (
    <CompatibilityBanner
      isChrome={isChrome}
      currentVersion={chromeVersion}
      isDismissable={canRender}
    />
  );

  if (!canRender) {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.render(
      <StrictMode>
        <LogAfterRender>
          <CssBaseline>{banner}</CssBaseline>
        </LogAfterRender>
      </StrictMode>,
      rootEl,
    );
    return;
  }

  // Use an async import to delay loading the majority of studio-base code until the CompatibilityBanner
  // can be displayed.
  const { installDevtoolsFormatters, overwriteFetch, waitForFonts, initI18n, StudioApp } =
    await import("@foxglove/studio-base");
  installDevtoolsFormatters();
  overwriteFetch();
  // consider moving waitForFonts into App to display an app loading screen
  await waitForFonts();
  await initI18n();

  const { WebRoot } = await import("./WebRoot");
  const params = await getParams();
  const rootElement = params.rootElement ?? (
    <WebRoot extraProviders={params.extraProviders} dataSources={params.dataSources}>
      <StudioApp />
    </WebRoot>
  );

  // eslint-disable-next-line react/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <LogAfterRender>
        {banner}
        {rootElement}
      </LogAfterRender>
    </StrictMode>,
    rootEl,
  );
}
