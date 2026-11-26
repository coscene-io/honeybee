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
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import {
  getBrowserAuthUrl,
  initializeBrowserSession,
  markBrowserCredentialInvalid,
} from "@foxglove/studio-base/util/browserSession";
import type { BrowserSessionSnapshot } from "@foxglove/studio-base/util/browserSession";
import { windowShareManifestParseResult } from "@foxglove/studio-base/util/shareManifest";

import { useCoSceneInit } from "./CoSceneInit";
import { fetchOrganizationAccess, OrganizationAccessView } from "./OrganizationAccess";
import type { OrganizationAccess } from "./OrganizationAccess";
import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

function sameAccessSession(
  previous: BrowserSessionSnapshot | undefined,
  current: BrowserSessionSnapshot | undefined,
): boolean {
  return previous?.credential === current?.credential && previous?.version === current?.version;
}

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
  const [accessSession, setAccessSession] = useState(() => session.readAccessSnapshot());
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  const status = session.getStatus();
  const preservesPlayback = session.preservesPlayback();
  const urlState = parseAppURLState(new URL(window.location.href));
  const key = urlState?.ds === "coscene-data-platform" ? urlState.dsParams?.key : undefined;
  const bffUrl = appConfig.VITE_APP_BFF_URL ?? "";
  const check = useMemo(() => {
    if (
      preservesPlayback ||
      !key ||
      !accessSession ||
      status === "recover" ||
      status === "logged-out"
    ) {
      return undefined;
    }
    return { key, bffUrl, accessSession, status };
  }, [accessSession, bffUrl, key, preservesPlayback, status]);
  const [completed, setCompleted] = useState<{
    check: NonNullable<typeof check>;
    attempt: number;
    result: OrganizationAccess;
  }>();
  const access = check != undefined && completed?.check === check ? completed.result : undefined;
  const retrying = access?.status === "error" && completed?.attempt !== attempt;
  const ready = preservesPlayback || (status === "current" && (!key || access?.status === "ready"));

  useEffect(() => {
    // Deduplicate notifications without missing a second replacement while already "changed".
    const refreshAccessSession = () => {
      const latest = session.readAccessSnapshot();
      setAccessSession((previous) => (sameAccessSession(previous, latest) ? previous : latest));
    };
    const unsubscribe = session.subscribe(() => {
      setRevision((value) => value + 1);
      refreshAccessSession();
    });
    const stopListening = session.listen(refreshAccessSession);
    return () => {
      unsubscribe();
      stopListening();
    };
  }, [session]);

  useEffect(() => {
    if (!check) {
      return;
    }
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted &&
      check.status === session.getStatus() &&
      sameAccessSession(check.accessSession, session.readAccessSnapshot());
    if (!isCurrent()) {
      return;
    }
    if (check.status === "current" && !session.credential) {
      // A first visit goes to login with the complete return URL.
      window.location.assign(getBrowserAuthUrl("/auth/login"));
      return;
    }
    const credential =
      check.status === "current" ? session.credential : check.accessSession.credential;
    const complete = (result: OrganizationAccess) => {
      setCompleted({ check, attempt, result });
    };
    const timeout = window.setTimeout(() => {
      if (isCurrent()) {
        complete({ status: "error" });
      }
      controller.abort();
    }, 20_000);
    void fetchOrganizationAccess(check.bffUrl, check.key, credential, controller.signal)
      .then((result) => {
        if (!isCurrent()) {
          return;
        }
        if (result.status === "login" && credential) {
          markBrowserCredentialInvalid(credential);
          if (check.status === "current") {
            session.rejectCredential(credential);
          }
        }
        complete(result);
      })
      .catch(() => {
        if (isCurrent()) {
          complete({ status: "error" });
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt, check, session]);

  useEffect(() => {
    if (ready) {
      setOpened(true);
    }
  }, [ready]);
  const jwt = session.credential;

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
  const showWorkspace = opened || ready;

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
            <div style={{ display: ready ? "contents" : "none" }}>
              <StudioApp />
            </div>
          )}
          {!ready && (
            <OrganizationAccessView
              access={access ?? { status: key ? "loading" : "ready" }}
              changed={changed}
              modal={opened}
              recovery={recovery}
              retrying={retrying}
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
