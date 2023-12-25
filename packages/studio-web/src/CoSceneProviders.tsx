// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useMemo } from "react";

import { ConsoleApi, CoSceneContext } from "@foxglove/studio-base";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoSceneLayoutStorageContext from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import CoSceneConsoleApiRemoteLayoutStorageProvider from "@foxglove/studio-base/providers/CoSceneConsoleApiRemoteLayoutStorageProvider";
import CoSceneCurrentLayoutProvider from "@foxglove/studio-base/providers/CoSceneCurrentLayoutProvider";
import CoSceneLayoutManagerProvider from "@foxglove/studio-base/providers/CoSceneLayoutManagerProvider";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoSceneProjectProvider from "@foxglove/studio-base/providers/CoSceneProjectProvider";
import CoSceneUserProfileLocalStorageProvider from "@foxglove/studio-base/providers/CoSceneUserProfileLocalStorageProvider";
import CoSceneUserProvider from "@foxglove/studio-base/providers/CoSceneUserProvider";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { IdbLayoutStorage } from "./services/CoSceneIdbLayoutStorage";

export function CoSceneProviders(): JSX.Element[] {
  const currentUser = localStorage.getItem("current_user") ?? "{}";
  const currentUserId = JSON.parse(currentUser).userId ?? "";

  if (currentUserId == undefined || currentUserId === "") {
    throw new Error("currentUserId is empty");
  }

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(APP_CONFIG.CS_HONEYBEE_BASE_URL, APP_CONFIG.VITE_APP_BFF_URL, {
        ...JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}"),
        currentUserId,
      } as CoSceneContext),
    [currentUserId],
  );

  consoleApi.setAuthHeader(localStorage.getItem("coScene_org_jwt") ?? "");

  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);

  const providers = useMemo(
    () => [
      <CoSceneUserProfileLocalStorageProvider key="CoSceneUserProfileLocalStorageProvider" />,
      <CoSceneUserProvider key="CoSceneUserProvider" />,
      <CoSceneConsoleApiContext.Provider value={consoleApi} key="CoSceneConsoleApiContext" />,
      <CoSceneConsoleApiRemoteLayoutStorageProvider key="CoSceneConsoleApiRemoteLayoutStorageProvider" />,
      <CoSceneLayoutStorageContext.Provider
        value={layoutStorage}
        key="CoSceneLayoutStorageContext"
      />,
      <CoSceneLayoutManagerProvider key="CoSceneLayoutManagerProvider" />,
      <CoSceneCurrentLayoutProvider key="CoSceneCurrentLayoutProvider" />,
      <CoScenePlaylistProvider key="CoScenePlaylistProvider" />,
      <CoSceneProjectProvider key="CoSceneProjectProvider" />,
    ],
    [consoleApi, layoutStorage],
  );

  return providers;
}
