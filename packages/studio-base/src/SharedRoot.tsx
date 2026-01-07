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
import { createPortal } from "react-dom";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import Logger from "@foxglove/log";
import GlobalCss from "@foxglove/studio-base/components/GlobalCss";
import {
  ISharedRootContext,
  SharedRootContext,
} from "@foxglove/studio-base/context/SharedRootContext";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { ColorSchemeThemeProvider } from "./components/ColorSchemeThemeProvider";
import CssBaseline from "./components/CssBaseline";
import ErrorBoundary from "./components/ErrorBoundary";
import AppConfigurationContext from "./context/AppConfigurationContext";

const log = Logger.getLogger(__filename);

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

  const appConfig = getAppConfig();

  if (
    appConfig.VITE_APP_PROJECT_ENV !== "aws" &&
    appConfig.VITE_APP_PROJECT_ENV !== "gcp" &&
    appConfig.POSTHOG?.token &&
    appConfig.POSTHOG.api_host
  ) {
    posthog.init(appConfig.POSTHOG.token, {
      api_host: appConfig.POSTHOG.api_host,
      person_profiles: "always",
    });
  }

  posthog.register_once({
    platform: isDesktopApp() ? "coStudio" : "honeybee",
    environment: appConfig.VITE_APP_PROJECT_ENV,
  });

  if (
    appConfig.VITE_APP_PROJECT_ENV !== "local" &&
    appConfig.VITE_APP_PROJECT_ENV !== "aws" &&
    appConfig.VITE_APP_PROJECT_ENV !== "gcp" &&
    appConfig.SENTRY_ENABLED != undefined
  ) {
    log.info("initializing Sentry");
    Sentry.init({
      dsn: appConfig.SENTRY_HONEYBEE_DSN,
      release: appConfig.RELEASE_TAG,
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
      environment: appConfig.VITE_APP_PROJECT_ENV,

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

  const toaster = <Toaster />;
  const toasterPortal =
    typeof document !== "undefined" ? createPortal(toaster, document.body) : toaster;

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
                {toasterPortal}
              </LocalizationProvider>
            </ErrorBoundary>
          </CssBaseline>
        </ColorSchemeThemeProvider>
      </PostHogProvider>
    </AppConfigurationContext.Provider>
  );
}
