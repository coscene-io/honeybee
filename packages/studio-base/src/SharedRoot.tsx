// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import GlobalCss from "@foxglove/studio-base/components/GlobalCss";
import {
  ISharedRootContext,
  SharedRootContext,
} from "@foxglove/studio-base/context/SharedRootContext";
import { initializeSentryErrorReporting } from "@foxglove/studio-base/services/initializeSentryErrorReporting";
import { sanitizePrivacySafeCaptureResult } from "@foxglove/studio-base/services/playbackPerformanceTelemetry";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { ColorSchemeThemeProvider } from "./components/ColorSchemeThemeProvider";
import CssBaseline from "./components/CssBaseline";
import ErrorBoundary from "./components/ErrorBoundary";
import AppConfigurationContext from "./context/AppConfigurationContext";
import { GrowthBookProvider } from "./providers/GrowthBookProvider";

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
      // Keep the existing capture/storage behavior; do not opt into newer SDK defaults.
      defaults: "unset",
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: "if_capture_pageview",
      persistence: "localStorage+cookie",
      disable_conversations: true,
      disable_product_tours: true,
      session_recording: { streamNetworkBody: false, captureJsonLd: false },
      person_profiles: "always",
      before_send: sanitizePrivacySafeCaptureResult,
    });
  }

  posthog.register_once({
    platform: isDesktopApp() ? "coStudio" : "honeybee",
    environment: appConfig.VITE_APP_PROJECT_ENV,
  });
  // Release changes across upgrades, so refresh it on every startup instead of preserving the
  // first value stored in PostHog persistence.
  posthog.register({ release: appConfig.RELEASE_TAG });

  initializeSentryErrorReporting(appConfig);

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
      <GrowthBookProvider>
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
      </GrowthBookProvider>
    </AppConfigurationContext.Provider>
  );
}
