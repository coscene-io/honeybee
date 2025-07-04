// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Bring in global modules and overrides required by studio source files
// This adds type declarations for bag, etc imports
// This adds type declarations for global react
// See typings/index.d.ts for additional included references
/// <reference types="./typings" />

export { SharedRoot } from "./SharedRoot";
export { StudioApp } from "./StudioApp";
export type { NetworkInterface, OsContext } from "./OsContext";
export type {
  IAppConfiguration,
  AppConfigurationValue,
  ChangeHandler,
} from "./context/AppConfigurationContext";
export { AppContext } from "./context/AppContext";
export type { IAppContext } from "./context/AppContext";
export type { IDataSourceFactory } from "./context/PlayerSelectionContext";
export { default as installDevtoolsFormatters } from "./util/installDevtoolsFormatters";
export { default as overwriteFetch } from "./util/overwriteFetch";
export { default as waitForFonts } from "./util/waitForFonts";
export { initI18n } from "./i18n";
export type { ExtensionLoader } from "./services/ExtensionLoader";
export type { ExtensionInfo, ExtensionNamespace } from "./types/Extensions";
export { AppSetting } from "./AppSetting";
export { default as FoxgloveWebSocketDataSourceFactory } from "./dataSources/FoxgloveWebSocketDataSourceFactory";
export { default as Ros1LocalBagDataSourceFactory } from "./dataSources/Ros1LocalBagDataSourceFactory";
export { default as Ros1SocketDataSourceFactory } from "./dataSources/Ros1SocketDataSourceFactory";
export { default as Ros2LocalBagDataSourceFactory } from "./dataSources/Ros2LocalBagDataSourceFactory";
export { default as RosbridgeDataSourceFactory } from "./dataSources/RosbridgeDataSourceFactory";
export { default as UlogLocalDataSourceFactory } from "./dataSources/UlogLocalDataSourceFactory";
export { default as VelodyneDataSourceFactory } from "./dataSources/VelodyneDataSourceFactory";
export { default as RemoteDataSourceFactory } from "./dataSources/RemoteDataSourceFactory";
export { default as McapLocalDataSourceFactory } from "./dataSources/McapLocalDataSourceFactory";
export { default as SampleNuscenesDataSourceFactory } from "./dataSources/SampleNuscenesDataSourceFactory";
export { LaunchPreferenceValue } from "@foxglove/studio-base/types/LaunchPreferenceValue";
export { reportError, setReportErrorHandler } from "./reportError";
export { makeWorkspaceContextInitialState } from "./providers/WorkspaceContextProvider";
export { default as ExtensionCatalogProvider } from "./providers/ExtensionCatalogProvider";
export { SharedProviders } from "./providers/SharedProviders";

// CoScene
export { migratePanelsState, migrateLayout } from "./services/migrateLayout";
export type { Layout, ISO8601Timestamp, ILayoutStorage } from "./services/CoSceneILayoutStorage";
export { default as CoSceneDataPlatformDataSourceFactory } from "./dataSources/CoSceneDataPlatformDataSourceFactory";
export { default as ConsoleApi } from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
export type { LayoutID } from "./context/CurrentLayoutContext";
export { IdbExtensionLoader } from "./services/IdbExtensionLoader";
export type { IUrdfStorage } from "./services/UrdfStorage";

export type { AppBarProps } from "./components/AppBar";

// desktop
export type { INativeWindow, NativeWindowEvent } from "./context/NativeWindowContext";
export type { INativeAppMenu, NativeAppMenuEvent } from "./context/NativeAppMenuContext";
