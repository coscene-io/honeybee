// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import * as Sentry from "@sentry/browser";
import dayjs from "dayjs";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import Logger from "@foxglove/log";
import GlobalCss from "@foxglove/studio-base/components/GlobalCss";
import {
  ISharedRootContext,
  SharedRootContext,
} from "@foxglove/studio-base/context/SharedRootContext";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { ColorSchemeThemeProvider } from "./components/ColorSchemeThemeProvider";
import CssBaseline from "./components/CssBaseline";
import ErrorBoundary from "./components/ErrorBoundary";
import AppConfigurationContext from "./context/AppConfigurationContext";

const log = Logger.getLogger(__filename);

if (
  APP_CONFIG.VITE_APP_PROJECT_ENV !== "aws" &&
  APP_CONFIG.VITE_APP_PROJECT_ENV !== "gcp" &&
  APP_CONFIG.POSTHOG.token &&
  APP_CONFIG.POSTHOG.api_host
) {
  posthog.init(APP_CONFIG.POSTHOG.token, {
    api_host: APP_CONFIG.POSTHOG.api_host,
    person_profiles: "always",
  });
}

posthog.register_once({
  platform: isDesktopApp() ? "coStudio" : "honeybee",
  environment: APP_CONFIG.VITE_APP_PROJECT_ENV,
});

export function SharedRoot(
  props: ISharedRootContext & { children: React.JSX.Element },
): React.JSX.Element {
  const {
    appBarLeftInset,
    appConfiguration,
    onAppBarDoubleClick,
    AppBarComponent,
    children,
    customWindowControlProps,
    dataSources,
    deepLinks,
    enableGlobalCss = false,
    enableLaunchPreferenceScreen,
    extraProviders,
    extensionLoaders,
  } = props;
  const { i18n } = useTranslation();

  if (
    APP_CONFIG.VITE_APP_PROJECT_ENV !== "local" &&
    APP_CONFIG.VITE_APP_PROJECT_ENV !== "aws" &&
    APP_CONFIG.VITE_APP_PROJECT_ENV !== "gcp" &&
    APP_CONFIG.SENTRY_ENABLED
  ) {
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
            Sentry.browserTracingIntegration({
              instrumentNavigation: false,
            }),
          ]);
      },
      environment: APP_CONFIG.VITE_APP_PROJECT_ENV,

      // We recommend adjusting this value in production, or using tracesSampler
      // for finer control
      tracesSampleRate: 0.1,
    });
  }

  const adapterLocale = i18n.language === "zh" ? "zh-cn" : i18n.language === "ja" ? "ja" : "en";

  useEffect(() => {
    if (i18n.language === "zh") {
      dayjs.locale("zh-cn");
    } else if (i18n.language === "en") {
      dayjs.locale("en");
    }
  }, [i18n.language]);

  return (
    <AppConfigurationContext.Provider value={appConfiguration}>
      <PostHogProvider client={posthog}>
        <ColorSchemeThemeProvider>
          {enableGlobalCss && <GlobalCss />}
          <CssBaseline>
            <ErrorBoundary>
              <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={adapterLocale}>
                <SharedRootContext.Provider
                  value={{
                    appBarLeftInset,
                    AppBarComponent,
                    appConfiguration,
                    customWindowControlProps,
                    dataSources,
                    deepLinks,
                    enableLaunchPreferenceScreen,
                    extensionLoaders,
                    extraProviders,
                    onAppBarDoubleClick,
                  }}
                >
                  {children}
                </SharedRootContext.Provider>
              </LocalizationProvider>
            </ErrorBoundary>
          </CssBaseline>
        </ColorSchemeThemeProvider>
      </PostHogProvider>
    </AppConfigurationContext.Provider>
  );
}
