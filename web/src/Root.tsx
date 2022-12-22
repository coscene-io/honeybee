// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo, useState } from "react";

import {
  // IDataSourceFactory,
  CoSceneIDataSourceFactory,
  // Ros1LocalBagDataSourceFactory,
  // Ros2LocalBagDataSourceFactory,
  // RosbridgeDataSourceFactory,
  // Ros1RemoteBagDataSourceFactory,
  // FoxgloveDataPlatformDataSourceFactory,
  CoSceneDataPlatformDataSourceFactory,
  // FoxgloveWebSocketDataSourceFactory,
  // UlogLocalDataSourceFactory,
  // McapLocalDataSourceFactory,
  // SampleNuscenesDataSourceFactory,
  IAppConfiguration,
  IdbExtensionLoader,
  // McapRemoteDataSourceFactory,
  App,
  ConsoleApi,
  CoSceneContext,
} from "@foxglove/studio-base";

// import Ros1UnavailableDataSourceFactory from "./dataSources/Ros1UnavailableDataSourceFactory";
// import Ros2UnavailableDataSourceFactory from "./dataSources/Ros2UnavailableDataSourceFactory";
// import VelodyneUnavailableDataSourceFactory from "./dataSources/VelodyneUnavailableDataSourceFactory";
import { IdbLayoutStorage } from "./services/IdbLayoutStorage";

export const getApiAddress = (env: "production" | "azureDev"): string => {
  switch (env) {
    case "production":
      return "https://honeybee.coscene.cn";
    case "azureDev":
      return "https://honeybee.coscene.dev";
    default:
      return "http://localhost:8080";
  }
};

export function Root({ appConfiguration }: { appConfiguration: IAppConfiguration }): JSX.Element {
  const dataSources: CoSceneIDataSourceFactory[] = useMemo(() => {
    const sources = [
      // new Ros1UnavailableDataSourceFactory(),
      // new Ros1LocalBagDataSourceFactory(),
      // new Ros1RemoteBagDataSourceFactory(),
      // new Ros2UnavailableDataSourceFactory(),
      // new Ros2LocalBagDataSourceFactory(),
      // new RosbridgeDataSourceFactory(),
      // new FoxgloveWebSocketDataSourceFactory(),
      // new UlogLocalDataSourceFactory(),
      // new VelodyneUnavailableDataSourceFactory(),
      // new FoxgloveDataPlatformDataSourceFactory(),
      new CoSceneDataPlatformDataSourceFactory(),
      // new SampleNuscenesDataSourceFactory(),
      // new McapLocalDataSourceFactory(),
      // new McapRemoteDataSourceFactory(),
    ];

    return sources;
  }, []);

  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);
  const [extensionLoaders] = useState(() => [
    new IdbExtensionLoader("org"),
    new IdbExtensionLoader("local"),
  ]);

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(
        getApiAddress(process.env.PROJECT_ENV as "production" | "azureDev"),
        JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}") as CoSceneContext,
      ),
    [],
  );

  // Enable dialog auth in development since using cookie auth does not work between
  // localhost and the hosted dev deployment due to browser cookie/host security.
  const enableDialogAuth =
    process.env.NODE_ENV === "development" || process.env.FOXGLOVE_ENABLE_DIALOG_AUTH != undefined;

  const disableSignin = process.env.FOXGLOVE_DISABLE_SIGN_IN != undefined;

  return (
    <App
      disableSignin={disableSignin}
      enableDialogAuth={enableDialogAuth}
      enableLaunchPreferenceScreen
      deepLinks={[window.location.href]}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      layoutStorage={layoutStorage}
      consoleApi={consoleApi}
      extensionLoaders={extensionLoaders}
    />
  );
}
