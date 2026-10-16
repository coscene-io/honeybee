// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";

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
import {
  getBrowserAuthUrl,
  initializeBrowserSession,
  markBrowserCredentialInvalid,
} from "@foxglove/studio-base/util/browserSession";
import { windowShareManifestParseResult } from "@foxglove/studio-base/util/shareManifest";

import { useCoSceneInit } from "./CoSceneInit";
import { fetchOrganizationAccess, OrganizationAccessView } from "./OrganizationAccess";
import type { OrganizationAccess } from "./OrganizationAccess";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function WebRoot(props: {
  extraProviders: React.JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
}): React.JSX.Element {
  const appConfig = getAppConfig();
  const baseUrl = appConfig.CS_HONEYBEE_BASE_URL ?? "";
  const [session] = useState(() => {
    const session = initializeBrowserSession();
    const share = windowShareManifestParseResult();
    session.setLocalPlayback({ local: share.status === "valid" || share.status === "expired" });
    return session;
  });
  const [deepLinks] = useState(() => [window.location.href]);
  const [, setRevision] = useState(0);
  const [access, setAccess] = useState<OrganizationAccess>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  const status = session.getStatus();
  const preservesPlayback = session.preservesPlayback();
  const key = new URL(window.location.href).searchParams.get("ds.key");
  useEffect(() => {
    if (preservesPlayback || !key) {
      setAccess({ status: "ready" });
      return;
    }
    if (status === "recover" || status === "logged-out") {
      return;
    }
    if (status === "current" && !session.credential) {
      // A first visit is a login, not recovery from an expired session. The
      // access gate owns this redirect because StudioApp is not mounted yet.
      window.location.assign(getBrowserAuthUrl("/auth/login"));
      return;
    }
    const controller = new AbortController();
    setAccess({ status: "loading" });
    let credential = session.credential;
    try {
      if (status === "changed") {
        credential = localStorage.getItem("coScene_org_jwt") ?? "";
      }
    } catch {
      setAccess({ status: "login" });
      return;
    }
    const timeout = window.setTimeout(() => {
      controller.abort();
      setAccess({ status: "error" });
    }, 20_000);
    void fetchOrganizationAccess(
      appConfig.VITE_APP_BFF_URL ?? "",
      key,
      credential,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          if (result.status === "login" && credential) {
            markBrowserCredentialInvalid(credential);
            if (status === "current") {
              session.rejectCredential(credential);
            }
          }
          setAccess(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAccess({ status: "error" });
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [appConfig.VITE_APP_BFF_URL, key, session, status, preservesPlayback, attempt]);
  useEffect(() => {
    if (access.status === "ready" && status === "current") {
      setOpened(true);
    }
  }, [access.status, status]);
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

  const changed = status === "changed" && !preservesPlayback;
  const recovery =
    !preservesPlayback && (status === "recover" || status === "logged-out") ? status : undefined;
  const blocked = !preservesPlayback && (status !== "current" || access.status !== "ready");
  const showWorkspace = opened || !blocked;

  return (
    <>
      <SharedRoot
        enableLaunchPreferenceScreen
        deepLinks={deepLinks}
        dataSources={dataSources}
        appConfiguration={appConfiguration}
        extensionLoaders={extensionLoaders}
        enableGlobalCss
        extraProviders={extraProviders}
        AppBarComponent={props.AppBarComponent}
      >
        <>
          {showWorkspace && (
            <div style={{ display: blocked ? "none" : "contents" }}>
              <StudioApp />
            </div>
          )}
          {blocked && (
            <OrganizationAccessView
              access={access}
              changed={changed}
              modal={opened && changed}
              recovery={recovery}
              onRetry={() => {
                setAttempt((value) => value + 1);
              }}
            />
          )}
        </>
      </SharedRoot>
    </>
  );
}
