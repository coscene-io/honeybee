// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CircularProgress } from "@mui/material";
import { useMemo, useState } from "react";
import { Toaster } from "react-hot-toast";

import {
  CoSceneIDataSourceFactory,
  CoSceneDataPlatformDataSourceFactory,
  FoxgloveWebSocketDataSourceFactory,
  SharedRoot,
  AppBarProps,
  AppSetting,
  IdbExtensionLoader,
  ConsoleApi,
  SharedProviders,
} from "@foxglove/studio-base";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { useCoSceneInit } from "./CoSceneInit";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function WebRoot(props: {
  extraProviders: React.JSX.Element[] | undefined;
  dataSources: CoSceneIDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
  children: React.JSX.Element;
}): React.JSX.Element {
  const baseUrl = APP_CONFIG.CS_HONEYBEE_BASE_URL;
  const jwt = localStorage.getItem("coScene_org_jwt") ?? "";

  const isLoading = useCoSceneInit({ baseUrl, jwt });

  // if has many sources need to set confirm
  // recommand set confirm to message pipeline
  const [confirm, confirmModal] = useConfirm();

  const appConfiguration = useMemo(
    () =>
      new LocalStorageAppConfiguration({
        defaults: {
          [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
        },
      }),
    [],
  );

  const [extensionLoaders] = useState(() => [
    new IdbExtensionLoader("org"),
    new IdbExtensionLoader("local"),
  ]);

  const dataSources = useMemo(() => {
    const sources = [
      new CoSceneDataPlatformDataSourceFactory(),
      new FoxgloveWebSocketDataSourceFactory({ confirm }),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources, confirm]);

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(
        baseUrl,
        APP_CONFIG.VITE_APP_BFF_URL,
        localStorage.getItem("CoScene_addTopicPrefix") ??
          APP_CONFIG.DEFAULT_TOPIC_PREFIX_OPEN[window.location.hostname] ??
          "false",
        localStorage.getItem("CoScene_timeMode") === "relativeTime"
          ? "relativeTime"
          : "absoluteTime",
      ),
    [baseUrl],
  );

  consoleApi.setAuthHeader(jwt);

  const coSceneProviders = SharedProviders({ consoleApi });

  const extraProviders = useMemo(() => {
    const providers = coSceneProviders;
    if (props.extraProviders != undefined) {
      providers.push(...props.extraProviders);
    }
    return providers;
  }, [coSceneProviders, props.extraProviders]);

  if (isLoading) {
    return (
      <Stack flex={1} fullHeight fullWidth justifyContent="center" alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <>
      <SharedRoot
        enableLaunchPreferenceScreen
        deepLinks={[window.location.href]}
        dataSources={dataSources}
        appConfiguration={appConfiguration}
        extensionLoaders={extensionLoaders}
        enableGlobalCss
        extraProviders={extraProviders}
        AppBarComponent={props.AppBarComponent}
      >
        {props.children}
      </SharedRoot>
      <Toaster />
      {confirmModal}
    </>
  );
}
