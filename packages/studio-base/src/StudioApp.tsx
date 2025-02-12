// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fragment, Suspense, useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import Log from "@foxglove/log";
import { useSharedRootContext } from "@foxglove/studio-base/context/SharedRootContext";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import ProblemsContextProvider from "@foxglove/studio-base/providers/ProblemsContextProvider";
import { StudioLogsSettingsProvider } from "@foxglove/studio-base/providers/StudioLogsSettingsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import UploadFilesProvider from "@foxglove/studio-base/providers/UploadFilesProvider";

import Workspace from "./Workspace";
import MultiProvider from "./components/MultiProvider";
import PlayerManager from "./components/PlayerManager";
import SendNotificationToastAdapter from "./components/SendNotificationToastAdapter";
import StudioToastProvider from "./components/StudioToastProvider";
import { UserScriptStateProvider } from "./context/UserScriptStateContext";
import ExtensionCatalogProvider from "./providers/ExtensionCatalogProvider";
import ExtensionMarketplaceProvider from "./providers/ExtensionMarketplaceProvider";
import PanelCatalogProvider from "./providers/PanelCatalogProvider";
import { LaunchPreference } from "./screens/LaunchPreference";

const log = Log.getLogger(__filename);
// Suppress context menu for the entire app except on inputs & textareas.
function contextMenuHandler(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  event.preventDefault();
  return false;
}

export function StudioApp(): React.JSX.Element {
  const {
    dataSources,
    extensionLoaders,
    deepLinks,
    enableLaunchPreferenceScreen,
    extraProviders,
    appBarLeftInset,
    customWindowControlProps,
    onAppBarDoubleClick,
    AppBarComponent,
  } = useSharedRootContext();

  const providers = [
    /* eslint-disable react/jsx-key */
    <TimelineInteractionStateProvider />,
    <UserScriptStateProvider />,
    <ExtensionMarketplaceProvider />,
    <ExtensionCatalogProvider loaders={extensionLoaders} />,
    <PlayerManager playerSources={dataSources} />,
    <EventsProvider />,
    <UploadFilesProvider />,
    /* eslint-enable react/jsx-key */
  ];

  if (extraProviders) {
    providers.unshift(...extraProviders);
  }

  // The toast and logs provider comes first so they are available to all downstream providers
  providers.unshift(<StudioToastProvider />);
  providers.unshift(<StudioLogsSettingsProvider />);

  // Problems provider also must come before other, depdendent contexts.
  providers.unshift(<ProblemsContextProvider />);

  const MaybeLaunchPreference = enableLaunchPreferenceScreen === true ? LaunchPreference : Fragment;

  useEffect(() => {
    document.addEventListener("contextmenu", contextMenuHandler);
    return () => {
      document.removeEventListener("contextmenu", contextMenuHandler);
    };
  }, []);

  useEffect(() => {
    log.info("COSTUDIO_APT_SOURCE", process.env.COSTUDIO_APT_SOURCE);
    log.info("COSTUDIO_DOWNLOAD_URL", process.env.COSTUDIO_DOWNLOAD_URL);
  }, []);

  return (
    <MaybeLaunchPreference>
      <MultiProvider providers={providers}>
        <SendNotificationToastAdapter />
        <DndProvider backend={HTML5Backend}>
          <Suspense fallback={<></>}>
            <PanelCatalogProvider>
              <Workspace
                deepLinks={deepLinks}
                appBarLeftInset={appBarLeftInset}
                onAppBarDoubleClick={onAppBarDoubleClick}
                showCustomWindowControls={customWindowControlProps?.showCustomWindowControls}
                isMaximized={customWindowControlProps?.isMaximized}
                initialZoomFactor={customWindowControlProps?.initialZoomFactor}
                onMinimizeWindow={customWindowControlProps?.onMinimizeWindow}
                onMaximizeWindow={customWindowControlProps?.onMaximizeWindow}
                onUnmaximizeWindow={customWindowControlProps?.onUnmaximizeWindow}
                onCloseWindow={customWindowControlProps?.onCloseWindow}
                AppBarComponent={AppBarComponent}
              />
            </PanelCatalogProvider>
          </Suspense>
        </DndProvider>
      </MultiProvider>
    </MaybeLaunchPreference>
  );
}
