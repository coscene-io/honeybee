// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom";

import Logger from "@foxglove/log";
import type { IDataSourceFactory } from "@foxglove/studio-base";
import CssBaseline from "@foxglove/studio-base/components/CssBaseline";

import VersionBanner from "./VersionBanner";
import { canRenderApp } from "./canRenderApp";

const log = Logger.getLogger(__filename);

function LogAfterRender(props: React.PropsWithChildren): React.JSX.Element {
  useEffect(() => {
    // Integration tests look for this console log to indicate the app has rendered once
    // We use console.debug to bypass our logging library which hides some log levels in prod builds
    console.debug("App rendered");
  }, []);
  return <>{props.children}</>;
}

export type MainParams = {
  dataSources?: IDataSourceFactory[];
  extraProviders?: React.JSX.Element[];
  rootElement?: React.JSX.Element;
};

export async function main(getParams: () => Promise<MainParams> = async () => ({})): Promise<void> {
  log.debug("initializing");

  window.onerror = (...args) => {
    console.error(...args);
  };

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("missing #root element");
  }

  const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)\./);
  const chromeVersion = chromeMatch ? parseInt(chromeMatch[1] ?? "", 10) : 0;
  const isChrome = chromeVersion !== 0;

  const canRender = canRenderApp();
  const banner = (
    <VersionBanner isChrome={isChrome} currentVersion={chromeVersion} isDismissable={canRender} />
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
  const { installDevtoolsFormatters, overwriteFetch, waitForFonts, initI18n } = await import(
    "@foxglove/studio-base"
  );
  installDevtoolsFormatters();
  overwriteFetch();
  // consider moving waitForFonts into App to display an app loading screen
  await waitForFonts();
  await initI18n();

  const { WebRoot } = await import("./WebRoot");
  const params = await getParams();
  const rootElement = params.rootElement ?? (
    <WebRoot extraProviders={params.extraProviders} dataSources={params.dataSources} />
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
