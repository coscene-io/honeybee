// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useMemo } from "react";

import { ConsoleApi } from "@foxglove/studio-base";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoSceneLayoutStorageContext from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import UrdfStorageContext from "@foxglove/studio-base/context/UrdfStorageContext";
import CoSceneBaseProvider from "@foxglove/studio-base/providers/CoSceneBaseProvider";
import CoSceneConsoleApiRemoteLayoutStorageProvider from "@foxglove/studio-base/providers/CoSceneConsoleApiRemoteLayoutStorageProvider";
import CoSceneCookiesProvider from "@foxglove/studio-base/providers/CoSceneCookiesProvider";
import CoSceneCurrentLayoutProvider from "@foxglove/studio-base/providers/CoSceneCurrentLayoutProvider";
import CoSceneLayoutManagerProvider from "@foxglove/studio-base/providers/CoSceneLayoutManagerProvider";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoSceneProjectProvider from "@foxglove/studio-base/providers/CoSceneProjectProvider";
import CoSceneUserProfileLocalStorageProvider from "@foxglove/studio-base/providers/CoSceneUserProfileLocalStorageProvider";
import CoSceneUserProvider from "@foxglove/studio-base/providers/CoSceneUserProvider";
import { IdbLayoutStorage } from "@foxglove/studio-base/services/CoSceneIdbLayoutStorage";
import { IdbUrdfStorage } from "@foxglove/studio-base/services/IdbUrdfStorage";
// import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

export function SharedProviders({ consoleApi }: { consoleApi: ConsoleApi }): JSX.Element[] {
  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);
  const urdfStorage = useMemo(() => new IdbUrdfStorage(), []);

  const providers = useMemo(
    () => [
      <CoSceneConsoleApiContext.Provider value={consoleApi} key="CoSceneConsoleApiContext" />,
      <CoSceneBaseProvider key="CoSceneBaseProvider" />,
      <CoSceneUserProfileLocalStorageProvider key="CoSceneUserProfileLocalStorageProvider" />,
      <CoSceneUserProvider key="CoSceneUserProvider" />,
      <CoSceneConsoleApiRemoteLayoutStorageProvider key="CoSceneConsoleApiRemoteLayoutStorageProvider" />,
      <CoSceneLayoutStorageContext.Provider
        value={layoutStorage}
        key="CoSceneLayoutStorageContext"
      />,
      <UrdfStorageContext.Provider value={urdfStorage} key="UrdfStorageContext" />,
      <CoSceneLayoutManagerProvider key="CoSceneLayoutManagerProvider" />,
      <CoSceneCurrentLayoutProvider key="CoSceneCurrentLayoutProvider" />,
      <CoScenePlaylistProvider key="CoScenePlaylistProvider" />,
      <CoSceneProjectProvider key="CoSceneProjectProvider" />,
      <CoSceneCookiesProvider key="CoSceneCookiesProvider" />,
    ],
    [consoleApi, layoutStorage, urdfStorage],
  );

  return providers;
}
