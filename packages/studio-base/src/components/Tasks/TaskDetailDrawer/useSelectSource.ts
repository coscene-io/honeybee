// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Device } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/device_pb";
import { useCallback } from "react";

import {
  BaseInfo,
  CoSceneBaseStore,
  useBaseInfo,
} from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { AppURLState, updateAppURLState } from "@foxglove/studio-base/util/appURLState";

export const REALTIME_VISUALIZATION_PORT = 21274;

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", newStateUrl.href);
}

function ipToHex(ip: string) {
  return ip
    .split(".")
    .map((part) => Number.parseInt(part, 10).toString(16).padStart(2, "0"))
    .join("");
}

const selectColinkApi = (store: CoSceneBaseStore) => store.colinkApi;
const selectCoordinatorConfig = (store: CoSceneBaseStore) => store.coordinatorConfig;
const selectUser = (store: UserStore) => store.user;

export function useVizTargetSource(): (
  params:
    | {
        baseInfo: BaseInfo;
        sourceId: "coscene-data-platform";
      }
    | {
        baseInfo: BaseInfo;
        sourceId: "coscene-websocket";
        device: Device;
      },
) => Promise<void> {
  const { selectSource } = usePlayerSelection();
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);
  const coordinatorConfig = useBaseInfo(selectCoordinatorConfig);
  const colinkApi = useBaseInfo(selectColinkApi);

  return useCallback(
    async (
      params:
        | {
            baseInfo: BaseInfo;
            sourceId: "coscene-data-platform";
          }
        | {
            baseInfo: BaseInfo;
            sourceId: "coscene-websocket";
            device: Device;
          },
    ) => {
      const { baseInfo, sourceId } = params;

      const key = await consoleApi.setBaseInfo(baseInfo);

      const updateUrlParams: AppURLState = {
        ds: sourceId,
        dsParams: {
          key,
        },
      };

      if (sourceId === "coscene-websocket") {
        const { device } = params;

        const targetDevice = await consoleApi.getDevice({ deviceName: device.name });

        const public_key =
          coordinatorConfig?.enabled === true
            ? targetDevice.tags.colink_pubkey ?? targetDevice.tags.virmesh_pubkey ?? ""
            : "";

        const proxy_server =
          coordinatorConfig?.enabled === true ? coordinatorConfig.proxy_server : "";

        const deviceColinkInfo = (
          await colinkApi?.deviceApiControllerGetDevice(baseInfo.organizationId ?? "", public_key)
        )?.data;

        const wsUrl = `wss://${deviceColinkInfo?.network_id}-${ipToHex(
          String(deviceColinkInfo?.private_ip ?? ""),
        )}${Number(REALTIME_VISUALIZATION_PORT).toString(16)}.${proxy_server}`;

        const fullName = targetDevice.displayName;

        const deviceLink = `https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}/${
          baseInfo.organizationSlug
        }/${baseInfo.projectSlug}/devices/project-devices/${targetDevice.name.split("/").pop()}`;

        updateUrlParams.dsParams = {
          ...updateUrlParams.dsParams,
          url: wsUrl,
          hostName: fullName,
          deviceLink,
        };
      }

      updateUrl(updateUrlParams);

      selectSource(sourceId, {
        type: "connection",
        params: { ...currentUser, ...updateUrlParams.dsParams },
      });
    },
    [selectSource],
  );
}
