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
  VelodyneDataSourceFactory,
  SharedProviders,
  ConsoleApi,
} from "@foxglove/studio-base";
import NativeAppMenuContext from "@foxglove/studio-base/context/NativeAppMenuContext";
import NativeWindowContext from "@foxglove/studio-base/context/NativeWindowContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";

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
  extraProviders: JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
}): JSX.Element {
  if (!storageBridge) {
    throw new Error("storageBridge is missing");
  }
  const { appConfiguration } = props;

  const { t } = useTranslation("appBar");

  // if has many sources need to set confirm
  // recommand set confirm to message pipeline
  const [confirm, confirmModal] = useConfirm();

  // notify user login status change
  const [loginStatusKey, setLoginStatusKey] = useState(0);

  // current not support connect to coscene
  const consoleApi = useMemo(
    () =>
      new ConsoleApi(
        "baseUrl",
        "bffUrl",
        "addTopicPrefix",
        localStorage.getItem("CoScene_timeMode") === "relativeTime"
          ? "relativeTime"
          : "absoluteTime",
      ),
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
    const authToken = localStorage.getItem("coScene_org_jwt");
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
  }, [consoleApi, t]);

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
      new FoxgloveWebSocketDataSourceFactory({ confirm }),
      new RosbridgeDataSourceFactory(),
      new Ros1SocketDataSourceFactory(),
      new Ros1LocalBagDataSourceFactory(),
      new Ros2LocalBagDataSourceFactory(),
      new UlogLocalDataSourceFactory(),
      new VelodyneDataSourceFactory(),
      new SampleNuscenesDataSourceFactory(),
      new McapLocalDataSourceFactory(),
      new RemoteDataSourceFactory(),
    ];

    return sources;
  }, [confirm, props.dataSources]);

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
    const providers: JSX.Element[] = initProviders;

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
      {confirmModal}
      <Toaster />
    </>
  );
}
