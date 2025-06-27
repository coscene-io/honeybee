// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  SharedRoot,
  StudioApp,
  AppSetting,
  FoxgloveWebSocketDataSourceFactory,
  IAppConfiguration,
  IDataSourceFactory,
  IdbExtensionLoader,
  McapLocalDataSourceFactory,
  OsContext,
  RemoteDataSourceFactory,
  Ros1LocalBagDataSourceFactory,
  Ros1SocketDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  SampleNuscenesDataSourceFactory,
  UlogLocalDataSourceFactory,
  // VelodyneDataSourceFactory,
  ConsoleApi,
  CoSceneDataPlatformDataSourceFactory,
  SharedProviders,
} from "@foxglove/studio-base";
import NativeAppMenuContext from "@foxglove/studio-base/context/NativeAppMenuContext";
import NativeWindowContext from "@foxglove/studio-base/context/NativeWindowContext";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { DesktopExtensionLoader } from "./services/DesktopExtensionLoader";
import { NativeAppMenu } from "./services/NativeAppMenu";
import { NativeWindow } from "./services/NativeWindow";
import { Auth, Desktop, NativeMenuBridge, Storage } from "../common/types";

const desktopBridge = (global as unknown as { desktopBridge: Desktop }).desktopBridge;
const storageBridge = (global as unknown as { storageBridge?: Storage }).storageBridge;
const menuBridge = (global as { menuBridge?: NativeMenuBridge }).menuBridge;
const ctxbridge = (global as { ctxbridge?: OsContext }).ctxbridge;
const authBridge = (global as { authBridge?: Auth }).authBridge;

export default function Root(props: {
  appConfiguration: IAppConfiguration;
  extraProviders: React.JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
}): React.JSX.Element {
  if (!storageBridge) {
    throw new Error("storageBridge is missing");
  }
  const { appConfiguration } = props;

  const { t } = useTranslation("appBar");

  // notify user login status change
  const [loginStatusKey, setLoginStatusKey] = useState(0);

  const authToken = localStorage.getItem("coScene_org_jwt");

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(APP_CONFIG.CS_HONEYBEE_BASE_URL, APP_CONFIG.VITE_APP_BFF_URL, authToken ?? ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const handler = () => {
      void desktopBridge.updateNativeColorScheme();
    };

    appConfiguration.addChangeListener(AppSetting.COLOR_SCHEME, handler);
    return () => {
      appConfiguration.removeChangeListener(AppSetting.COLOR_SCHEME, handler);
    };
  }, [appConfiguration]);

  useEffect(() => {
    const handler = () => {
      desktopBridge.updateLanguage();
    };
    appConfiguration.addChangeListener(AppSetting.LANGUAGE, handler);
    return () => {
      appConfiguration.removeChangeListener(AppSetting.LANGUAGE, handler);
    };
  }, [appConfiguration]);

  useEffect(() => {
    if (authToken) {
      consoleApi.setAuthHeader(authToken);
    }

    const cleanup = authBridge?.onAuthToken((token) => {
      localStorage.setItem("coScene_org_jwt", token);
      consoleApi.setAuthHeader(token);
      setLoginStatusKey((key) => key + 1);
      toast.success(t("loginSuccess"));
    });

    return cleanup;
  }, [consoleApi, t, authToken]);

  useEffect(() => {
    // Passive logout, token expired
    const cleanup = authBridge?.onLogout(() => {
      toast.error(t("loginExpired", { ns: "cosAccount" }));
      localStorage.removeItem("coScene_org_jwt");
      setLoginStatusKey((key) => key + 1);
    });

    return cleanup;
  }, [t]);

  const [extensionLoaders] = useState(() => [
    new IdbExtensionLoader("org"),
    new DesktopExtensionLoader(desktopBridge),
  ]);

  const nativeAppMenu = useMemo(() => new NativeAppMenu(menuBridge), []);
  const nativeWindow = useMemo(() => new NativeWindow(desktopBridge), []);

  const dataSources: IDataSourceFactory[] = useMemo(() => {
    if (props.dataSources) {
      return props.dataSources;
    }

    const sources = [
      new FoxgloveWebSocketDataSourceFactory(),
      new RosbridgeDataSourceFactory(),
      new Ros1SocketDataSourceFactory(),
      new CoSceneDataPlatformDataSourceFactory(),
      new Ros1LocalBagDataSourceFactory(),
      new Ros2LocalBagDataSourceFactory(),
      new UlogLocalDataSourceFactory(),
      // new VelodyneDataSourceFactory(),
      new SampleNuscenesDataSourceFactory(),
      new McapLocalDataSourceFactory(),
      new RemoteDataSourceFactory(),
    ];

    return sources;
  }, [props.dataSources]);

  // App url state in window.location will represent the user's current session state
  // better than the initial deep link so we prioritize the current window.location
  // url for startup state. This persists state across user-initiated refreshes.
  const [deepLinks] = useState(() => {
    // We treat presence of the `ds` or `layoutId` params as indicative of active state.
    const windowUrl = new URL(window.location.href);
    const hasActiveURLState =
      windowUrl.searchParams.has("ds") || windowUrl.searchParams.has("layoutId");
    return hasActiveURLState ? [window.location.href] : desktopBridge.getDeepLinks();
  });

  const [isFullScreen, setFullScreen] = useState(false);
  const [isMaximized, setMaximized] = useState(nativeWindow.isMaximized());

  const onMinimizeWindow = useCallback(() => {
    nativeWindow.minimize();
  }, [nativeWindow]);
  const onMaximizeWindow = useCallback(() => {
    nativeWindow.maximize();
  }, [nativeWindow]);
  const onUnmaximizeWindow = useCallback(() => {
    nativeWindow.unmaximize();
  }, [nativeWindow]);
  const onCloseWindow = useCallback(() => {
    nativeWindow.close();
  }, [nativeWindow]);

  useEffect(() => {
    const unregisterFull = desktopBridge.addIpcEventListener("enter-full-screen", () => {
      setFullScreen(true);
    });
    const unregisterLeave = desktopBridge.addIpcEventListener("leave-full-screen", () => {
      setFullScreen(false);
    });
    const unregisterMax = desktopBridge.addIpcEventListener("maximize", () => {
      setMaximized(true);
    });
    const unregisterUnMax = desktopBridge.addIpcEventListener("unmaximize", () => {
      setMaximized(false);
    });
    return () => {
      unregisterFull();
      unregisterLeave();
      unregisterMax();
      unregisterUnMax();
    };
  }, []);

  const initProviders = SharedProviders({ consoleApi, loginStatusKey });

  const extraProviders = useMemo(() => {
    const providers: React.JSX.Element[] = initProviders;

    providers.push(<NativeAppMenuContext.Provider value={nativeAppMenu} />);

    providers.push(<NativeWindowContext.Provider value={nativeWindow} />);

    if (props.extraProviders != undefined) {
      providers.push(...props.extraProviders);
    }
    return providers;
  }, [initProviders, nativeAppMenu, nativeWindow, props.extraProviders]);

  return (
    <>
      <SharedRoot
        appBarLeftInset={ctxbridge?.platform === "darwin" && !isFullScreen ? 72 : undefined}
        appConfiguration={appConfiguration}
        onAppBarDoubleClick={() => {
          nativeWindow.handleTitleBarDoubleClick();
        }}
        dataSources={dataSources}
        deepLinks={deepLinks}
        enableGlobalCss
        enableLaunchPreferenceScreen
        extraProviders={extraProviders}
        customWindowControlProps={{
          showCustomWindowControls: ctxbridge?.platform === "linux",
          isMaximized,
          onMinimizeWindow,
          onMaximizeWindow,
          onUnmaximizeWindow,
          onCloseWindow,
        }}
        extensionLoaders={extensionLoaders}
      >
        <StudioApp />
      </SharedRoot>
      <Toaster />
    </>
  );
}
