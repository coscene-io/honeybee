// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useMemo } from "react";

import AnalyticsProvider from "@foxglove/studio-base/context/AnalyticsProvider";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoSceneLayoutStorageContext from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import UrdfStorageContext from "@foxglove/studio-base/context/UrdfStorageContext";
import CoSceneBaseProvider from "@foxglove/studio-base/providers/CoSceneBaseProvider";
import CoSceneConsoleApiRemoteLayoutStorageProvider from "@foxglove/studio-base/providers/CoSceneConsoleApiRemoteLayoutStorageProvider";
import CoSceneCookiesProvider from "@foxglove/studio-base/providers/CoSceneCookiesProvider";
import CoSceneLayoutManagerProvider from "@foxglove/studio-base/providers/CoSceneLayoutManagerProvider";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoSceneProjectProvider from "@foxglove/studio-base/providers/CoSceneProjectProvider";
import CoSceneUserProfileLocalStorageProvider from "@foxglove/studio-base/providers/CoSceneUserProfileLocalStorageProvider";
import CoSceneUserProvider from "@foxglove/studio-base/providers/CoSceneUserProvider";
import CurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider";
import ConsoleApi from "@foxglove/studio-base/services/CoSceneConsoleApi";
import { IdbLayoutStorage } from "@foxglove/studio-base/services/CoSceneIdbLayoutStorage";
import { LayoutLoader } from "@foxglove/studio-base/services/ILayoutLoader";
import { IdbUrdfStorage } from "@foxglove/studio-base/services/IdbUrdfStorage";

export function SharedProviders({
  consoleApi,
  loginStatusKey,
  loaders,
}: {
  consoleApi: ConsoleApi;
  loginStatusKey?: number;
  loaders?: readonly LayoutLoader[];
}): React.JSX.Element[] {
  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);
  const urdfStorage = useMemo(() => new IdbUrdfStorage(), []);

  const providers = useMemo(
    () => [
      <CoSceneConsoleApiContext.Provider value={consoleApi} key="CoSceneConsoleApiContext" />,
      <CoSceneBaseProvider key="CoSceneBaseProvider" />,
      <CoSceneProjectProvider key="CoSceneProjectProvider" />,
      <CoSceneUserProfileLocalStorageProvider key="CoSceneUserProfileLocalStorageProvider" />,
      <CoSceneUserProvider key="CoSceneUserProvider" loginStatusKey={loginStatusKey} />,
      // dependent - CoSceneUserProvider
      <AnalyticsProvider key="AnalyticsProvider" />,
      <CoSceneConsoleApiRemoteLayoutStorageProvider key="CoSceneConsoleApiRemoteLayoutStorageProvider" />,
      <CoSceneLayoutStorageContext.Provider
        value={layoutStorage}
        key="CoSceneLayoutStorageContext"
      />,
      <UrdfStorageContext.Provider value={urdfStorage} key="UrdfStorageContext" />,
      <CoSceneLayoutManagerProvider key="CoSceneLayoutManagerProvider" />,
      <CurrentLayoutProvider key="CurrentLayoutProvider" loaders={loaders} />,
      <CoScenePlaylistProvider key="CoScenePlaylistProvider" />,
      <CoSceneCookiesProvider key="CoSceneCookiesProvider" />,
    ],
    [consoleApi, loginStatusKey, layoutStorage, urdfStorage, loaders],
  );

  return providers;
}
