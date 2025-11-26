// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Device } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { useCallback, useMemo } from "react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  CoreDataStore,
  ExternalInitConfig,
  useCoreData,
} from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
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

const selectColinkApi = (store: CoreDataStore) => store.colinkApi;
const selectCoordinatorConfig = (store: CoreDataStore) => store.coordinatorConfig;
const selectOrganization = (store: CoreDataStore) => store.organization;
const selectProject = (store: CoreDataStore) => store.project;

const selectUser = (store: UserStore) => store.user;
const selectSetViewingTask = (store: TaskStore) => store.setViewingTask;

// only support select current project source
// deppend on project slug and organization info
export function useVizTargetSource(): (
  params:
    | {
        externalInitConfig: ExternalInitConfig;
        sourceId: "coscene-data-platform";
      }
    | {
        externalInitConfig: ExternalInitConfig;
        sourceId: "coscene-websocket";
        device: Device;
      },
) => Promise<void> {
  const { selectSource } = usePlayerSelection();
  const consoleApi = useConsoleApi();
  const domainConfig = getDomainConfig();
  const currentUser = useCurrentUser(selectUser);
  const coordinatorConfig = useCoreData(selectCoordinatorConfig);
  const colinkApi = useCoreData(selectColinkApi);
  const setViewingTask = useTasks(selectSetViewingTask);
  const organization = useCoreData(selectOrganization);
  const project = useCoreData(selectProject);

  const projectSlug = useMemo(() => project.value?.slug ?? "", [project.value]);

  const organizationId = useMemo(
    () => organization.value?.name.split("/").pop() ?? "",
    [organization.value],
  );

  const organizationSlug = useMemo(() => organization.value?.slug ?? "", [organization.value]);

  return useCallback(
    async (
      params:
        | {
            externalInitConfig: ExternalInitConfig;
            sourceId: "coscene-data-platform";
          }
        | {
            externalInitConfig: ExternalInitConfig;
            sourceId: "coscene-websocket";
            device: Device;
          },
    ) => {
      const { externalInitConfig, sourceId } = params;

      const key = await consoleApi.setExternalInitConfig(externalInitConfig);

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
          await colinkApi?.deviceApiControllerGetDevice(organizationId, public_key)
        )?.data;

        const wsUrl = `wss://${deviceColinkInfo?.network_id}-${ipToHex(
          String(deviceColinkInfo?.private_ip ?? ""),
        )}${Number(REALTIME_VISUALIZATION_PORT).toString(16)}.${proxy_server}`;

        const fullName = targetDevice.displayName;

        const deviceLink = `https://${
          domainConfig.webDomain
        }/${organizationSlug}/${projectSlug}/devices/project-devices/${targetDevice.name
          .split("/")
          .pop()}`;

        updateUrlParams.dsParams = {
          ...updateUrlParams.dsParams,
          url: wsUrl,
          hostName: fullName,
          deviceLink,
        };
      }

      setViewingTask(undefined);

      updateUrl(updateUrlParams);

      selectSource(sourceId, {
        type: "connection",
        params: { ...currentUser, ...updateUrlParams.dsParams },
      });
    },
    [selectSource],
  );
}
