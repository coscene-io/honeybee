// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CsWebClient } from "@coscene-io/coscene/queries";
import { Fragment, Suspense, useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { DesktopInterfaceChangeWindowReloader } from "@foxglove/studio-base/components/DesktopInterfaceChangeWindowReloader";
import GlobalCss from "@foxglove/studio-base/components/GlobalCss";
import CoSceneProjectProvider from "@foxglove/studio-base/providers/CoSceneProjectProvider";
import CoSceneRecordProvider from "@foxglove/studio-base/providers/CoSceneRecordProvider";

import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import { StudioLogsSettingsProvider } from "@foxglove/studio-base/providers/StudioLogsSettingsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import Workspace from "./Workspace";
import { CustomWindowControlsProps } from "./components/AppBar/CustomWindowControls";
import { ColorSchemeThemeProvider } from "./components/ColorSchemeThemeProvider";
import CssBaseline from "./components/CssBaseline";
import DocumentTitleAdapter from "./components/DocumentTitleAdapter";
import ErrorBoundary from "./components/ErrorBoundary";
import MultiProvider from "./components/MultiProvider";
import PlayerManager from "./components/PlayerManager";
import SendNotificationToastAdapter from "./components/SendNotificationToastAdapter";
import StudioToastProvider from "./components/StudioToastProvider";
import AppConfigurationContext, { IAppConfiguration } from "./context/AppConfigurationContext";
import { IDataSourceFactory } from "./context/CoScenePlayerSelectionContext";
import ConsoleApiContext from "./context/ConsoleApiContext";
import LayoutStorageContext from "./context/LayoutStorageContext";
import NativeAppMenuContext, { INativeAppMenu } from "./context/NativeAppMenuContext";
import NativeWindowContext, { INativeWindow } from "./context/NativeWindowContext";
import { UserNodeStateProvider } from "./context/UserNodeStateContext";
import CurrentLayoutProvider from "./providers/CurrentLayoutProvider";
import ExtensionCatalogProvider from "./providers/ExtensionCatalogProvider";
import ExtensionMarketplaceProvider from "./providers/ExtensionMarketplaceProvider";
import LayoutManagerProvider from "./providers/LayoutManagerProvider";
import PanelCatalogProvider from "./providers/PanelCatalogProvider";
import UserProfileLocalStorageProvider from "./providers/UserProfileLocalStorageProvider";
import { LaunchPreference } from "./screens/LaunchPreference";
import ConsoleApi from "./services/CoSceneConsoleApi";
import { ExtensionLoader } from "./services/ExtensionLoader";
import { ILayoutStorage } from "./services/ILayoutStorage";

CsWebClient.init({
  hostname: APP_CONFIG.VITE_APP_BASE_API_URL,
  port: APP_CONFIG.VITE_APP_BASE_API_PORT,
});

type AppProps = CustomWindowControlsProps & {
  deepLinks: string[];
  appConfiguration: IAppConfiguration;
  dataSources: IDataSourceFactory[];
  layoutStorage: ILayoutStorage;
  extensionLoaders: readonly ExtensionLoader[];
  nativeAppMenu?: INativeAppMenu;
  nativeWindow?: INativeWindow;
  enableLaunchPreferenceScreen?: boolean;
  enableGlobalCss?: boolean;
  appBarLeftInset?: number;
  extraProviders?: JSX.Element[];
  onAppBarDoubleClick?: () => void;
  consoleApi: ConsoleApi;
  onReloadWindow?: () => void;
};

// Suppress context menu for the entire app except on inputs & textareas.
function contextMenuHandler(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  event.preventDefault();
  return false;
}

export function App(props: AppProps): JSX.Element {
  const {
    appConfiguration,
    dataSources,
    layoutStorage,
    extensionLoaders,
    nativeAppMenu,
    nativeWindow,
    deepLinks,
    enableLaunchPreferenceScreen,
    enableGlobalCss = false,
    extraProviders,
    consoleApi,
  } = props;

  const providers = [
    /* eslint-disable react/jsx-key */
    <UserProfileLocalStorageProvider />,
    <ConsoleApiContext.Provider value={consoleApi} />,
    <TimelineInteractionStateProvider />,
    <UserNodeStateProvider />,
    <CurrentLayoutProvider />,
    <ExtensionMarketplaceProvider />,
    <ExtensionCatalogProvider loaders={extensionLoaders} />,
    <PlayerManager playerSources={dataSources} />,
    <EventsProvider />,
    <CoSceneRecordProvider />,
    <CoSceneProjectProvider />,
    /* eslint-enable react/jsx-key */
  ];

  if (nativeAppMenu) {
    providers.push(<NativeAppMenuContext.Provider value={nativeAppMenu} />);
  }

  if (nativeWindow) {
    providers.push(<NativeWindowContext.Provider value={nativeWindow} />);
  }

  if (extraProviders) {
    providers.unshift(...extraProviders);
  } else {
    // Extra providers have their own layout providers
    providers.unshift(<LayoutManagerProvider />);
    providers.unshift(<LayoutStorageContext.Provider value={layoutStorage} />);
  }

  // The toast and logs provider comes first so they are available to all downstream providers
  providers.unshift(<StudioToastProvider />);
  providers.unshift(<StudioLogsSettingsProvider />);

  const MaybeLaunchPreference = enableLaunchPreferenceScreen === true ? LaunchPreference : Fragment;

  useEffect(() => {
    document.addEventListener("contextmenu", contextMenuHandler);
    return () => document.removeEventListener("contextmenu", contextMenuHandler);
  }, []);

  return (
    <AppConfigurationContext.Provider value={appConfiguration}>
      <ColorSchemeThemeProvider>
        {enableGlobalCss && <GlobalCss />}
        <CssBaseline>
          <ErrorBoundary>
            <MaybeLaunchPreference>
              <MultiProvider providers={providers}>
                <DocumentTitleAdapter />
                <SendNotificationToastAdapter />
                <DndProvider backend={HTML5Backend}>
                  <Suspense fallback={<></>}>
                    <PanelCatalogProvider>
                      <Workspace
                        deepLinks={deepLinks}
                        appBarLeftInset={props.appBarLeftInset}
                        onAppBarDoubleClick={props.onAppBarDoubleClick}
                        showCustomWindowControls={props.showCustomWindowControls}
                        isMaximized={props.isMaximized}
                        onMinimizeWindow={props.onMinimizeWindow}
                        onMaximizeWindow={props.onMaximizeWindow}
                        onUnmaximizeWindow={props.onUnmaximizeWindow}
                        onCloseWindow={props.onCloseWindow}
                      />
                      {props.onReloadWindow && (
                        <DesktopInterfaceChangeWindowReloader reloadWindow={props.onReloadWindow} />
                      )}
                    </PanelCatalogProvider>
                  </Suspense>
                </DndProvider>
              </MultiProvider>
            </MaybeLaunchPreference>
          </ErrorBoundary>
        </CssBaseline>
      </ColorSchemeThemeProvider>
    </AppConfigurationContext.Provider>
  );
}
