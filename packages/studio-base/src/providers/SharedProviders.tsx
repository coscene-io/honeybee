// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useMemo } from "react";

import AnalyticsProvider from "@foxglove/studio-base/context/AnalyticsProvider";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoSceneLayoutStorageContext from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import S3FileServiceContext from "@foxglove/studio-base/context/S3FileServiceContext";
import UrdfStorageContext from "@foxglove/studio-base/context/UrdfStorageContext";
import CoSceneConsoleApiRemoteLayoutStorageProvider from "@foxglove/studio-base/providers/CoSceneConsoleApiRemoteLayoutStorageProvider";
import CoSceneCookiesProvider from "@foxglove/studio-base/providers/CoSceneCookiesProvider";
import CoSceneCurrentUserProvider from "@foxglove/studio-base/providers/CoSceneCurrentUserProvider";
import CoSceneLayoutManagerProvider from "@foxglove/studio-base/providers/CoSceneLayoutManagerProvider";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoSceneUserProfileLocalStorageProvider from "@foxglove/studio-base/providers/CoSceneUserProfileLocalStorageProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import CurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import { IdbLayoutStorage } from "@foxglove/studio-base/services/CoSceneIdbLayoutStorage";
import { IdbUrdfStorage } from "@foxglove/studio-base/services/IdbUrdfStorage";
import { S3FileService } from "@foxglove/studio-base/services/S3FileService";
import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

export function SharedProviders({
  consoleApi,
  loginStatusKey,
}: {
  consoleApi: ConsoleApi;
  loginStatusKey?: number;
}): React.JSX.Element[] {
  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);
  const urdfStorage = useMemo(() => new IdbUrdfStorage(), []);
  const s3FileService = useMemo(() => new S3FileService(consoleApi), [consoleApi]);

  const providers = useMemo(
    () => [
      <DialogsProvider key="DialogsProvider" />,
      <CoSceneConsoleApiContext.Provider value={consoleApi} key="CoSceneConsoleApiContext" />,
      <S3FileServiceContext.Provider value={s3FileService} key="S3FileServiceContext" />,
      <CoreDataProvider key="CoreDataProvider" />,
      <CoSceneUserProfileLocalStorageProvider key="CoSceneUserProfileLocalStorageProvider" />,
      <CoSceneCurrentUserProvider key="CoSceneUserProvider" loginStatusKey={loginStatusKey} />,
      // dependent - CoSceneUserProvider
      <AnalyticsProvider key="AnalyticsProvider" />,
      <CoSceneConsoleApiRemoteLayoutStorageProvider key="CoSceneConsoleApiRemoteLayoutStorageProvider" />,
      <CoSceneLayoutStorageContext.Provider
        value={layoutStorage}
        key="CoSceneLayoutStorageContext"
      />,
      <UrdfStorageContext.Provider value={urdfStorage} key="UrdfStorageContext" />,
      <CoSceneLayoutManagerProvider key="CoSceneLayoutManagerProvider" />,
      <CurrentLayoutProvider key="CurrentLayoutProvider" />,
      <CoScenePlaylistProvider key="CoScenePlaylistProvider" />,
      <CoSceneCookiesProvider key="CoSceneCookiesProvider" />,
    ],
    [consoleApi, loginStatusKey, layoutStorage, urdfStorage, s3FileService],
  );

  return providers;
}
