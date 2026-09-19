// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  IDataSourceFactory,
  CoSceneDataPlatformDataSourceFactory,
  FoxgloveWebSocketDataSourceFactory,
  SharedRoot,
  AppBarProps,
  AppSetting,
  IdbExtensionLoader,
  ConsoleApi,
  SharedProviders,
  PersistentCacheDataSourceFactory,
  CoSceneShareManifestDataSourceFactory,
  RemoteMp4DataSourceFactory,
} from "@foxglove/studio-base";
import { StudioApp } from "@foxglove/studio-base/StudioApp";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";
import { initializeBrowserSession } from "@foxglove/studio-base/util/browserSession";

import { useCoSceneInit } from "./CoSceneInit";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function WebRoot(props: {
  extraProviders: React.JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
}): React.JSX.Element {
  const appConfig = getAppConfig();
  const baseUrl = appConfig.CS_HONEYBEE_BASE_URL ?? "";
  const [session] = useState(initializeBrowserSession);
  const [, setRevision] = useState(0);
  const { t } = useTranslation("appBar");
  const jwt = session.credential;
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setRevision((value) => value + 1);
    });
    const stopListening = session.listen();
    return () => {
      unsubscribe();
      stopListening();
    };
  }, [session]);

  useCoSceneInit();

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
      new CoSceneShareManifestDataSourceFactory(),
      new FoxgloveWebSocketDataSourceFactory(),
      new RemoteMp4DataSourceFactory(),
      new PersistentCacheDataSourceFactory(),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources]);

  const consoleApi = useMemo(
    () => new ConsoleApi(baseUrl, appConfig.VITE_APP_BFF_URL ?? "", jwt),
    [baseUrl, jwt, appConfig.VITE_APP_BFF_URL],
  );

  const coSceneProviders = SharedProviders({ consoleApi });

  const extraProviders = useMemo(() => {
    const providers = coSceneProviders;
    if (props.extraProviders != undefined) {
      providers.push(...props.extraProviders);
    }
    return providers;
  }, [coSceneProviders, props.extraProviders]);

  if (session.getStatus() !== "current" && !session.preservesPlayback()) {
    return (
      <main role="alert" style={{ padding: 32 }}>
        <p>
          {t(
            session.getStatus() === "changed"
              ? "sessionChanged"
              : session.getStatus() === "logged-out"
                ? "sessionLoggedOut"
                : "sessionRecoveryRequired",
          )}
        </p>
        {session.getStatus() === "changed" ? (
          <button
            onClick={() => {
              window.location.reload();
            }}
          >
            {t("reloadSession")}
          </button>
        ) : (
          <a
            target="_self"
            href={session.getStatus() === "logged-out" ? "/auth/logged-out" : "/auth/recover"}
          >
            {t("openSessionRecovery")}
          </a>
        )}
      </main>
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
        <StudioApp />
      </SharedRoot>
    </>
  );
}
