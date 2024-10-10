// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

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
} from "@foxglove/studio-base";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";

import { useCoSceneInit } from "./CoSceneInit";
import { CoSceneProviders } from "./CoSceneProviders";
import { JoyrideWrapper } from "./Joyride";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function WebRoot(props: {
  extraProviders: JSX.Element[] | undefined;
  dataSources: CoSceneIDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  useCoSceneInit();

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
      new FoxgloveWebSocketDataSourceFactory({ confirm }),
      new CoSceneDataPlatformDataSourceFactory(),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources, confirm]);

  const coSceneProviders = CoSceneProviders();

  const extraProviders = useMemo(() => {
    const providers = coSceneProviders;
    if (props.extraProviders != undefined) {
      providers.push(...props.extraProviders);
    }
    return providers;
  }, [coSceneProviders, props.extraProviders]);

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
      <JoyrideWrapper />
      <Toaster />
      {confirmModal}
    </>
  );
}
