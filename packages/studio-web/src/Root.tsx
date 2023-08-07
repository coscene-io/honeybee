// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useFavicon } from "react-use";

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
  IdbExtensionLoader,
  // McapRemoteDataSourceFactory,
  // RemoteDataSourceFactory,
  App,
  ConsoleApi,
  CoSceneContext,
  AppSetting,
} from "@foxglove/studio-base";
// import Ros1UnavailableDataSourceFactory from "./dataSources/Ros1UnavailableDataSourceFactory";
// import Ros2UnavailableDataSourceFactory from "./dataSources/Ros2UnavailableDataSourceFactory";
// import VelodyneUnavailableDataSourceFactory from "./dataSources/VelodyneUnavailableDataSourceFactory";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { JoyrideWrapper } from "./Joyride";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function Root(props: {
  extraProviders: JSX.Element[] | undefined;
  dataSources: CoSceneIDataSourceFactory[] | undefined;
}): JSX.Element {
  const appConfiguration = useMemo(
    () =>
      new LocalStorageAppConfiguration({
        defaults: {
          [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
        },
      }),
    [],
  );

  let favicon = "";
  switch (APP_CONFIG.VITE_APP_PROJECT_ENV) {
    case "local":
      favicon = "/logo-light.svg";
      break;
    case "keenon":
      favicon = "/viz/keenon_favicon.svg";
      break;
    default:
      favicon = "/viz/logo-light.svg";
  }

  useFavicon(favicon);

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
      // new RemoteDataSourceFactory(),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources]);

  const [extensionLoaders] = useState(() => [
    new IdbExtensionLoader("org"),
    new IdbExtensionLoader("local"),
  ]);

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(
        APP_CONFIG.CS_HONEYBEE_BASE_URL,
        JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}") as CoSceneContext,
      ),
    [],
  );

  return (
    <>
      <App
        enableLaunchPreferenceScreen
        deepLinks={[window.location.href]}
        dataSources={dataSources}
        appConfiguration={appConfiguration}
        consoleApi={consoleApi}
        extensionLoaders={extensionLoaders}
        enableGlobalCss
        extraProviders={props.extraProviders}
      />
      <JoyrideWrapper />
      <Toaster />
    </>
  );
}
