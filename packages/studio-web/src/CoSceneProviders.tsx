// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/file_pb";
import { useMemo, useEffect } from "react";

import Logger from "@foxglove/log";
import { ConsoleApi, CoSceneContext } from "@foxglove/studio-base";
import { BaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoSceneLayoutStorageContext from "@foxglove/studio-base/context/CoSceneLayoutStorageContext";
import CoSceneBaseProvider from "@foxglove/studio-base/providers/CoSceneBaseProvider";
import CoSceneConsoleApiRemoteLayoutStorageProvider from "@foxglove/studio-base/providers/CoSceneConsoleApiRemoteLayoutStorageProvider";
import CoSceneCurrentLayoutProvider from "@foxglove/studio-base/providers/CoSceneCurrentLayoutProvider";
import CoSceneLayoutManagerProvider from "@foxglove/studio-base/providers/CoSceneLayoutManagerProvider";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoSceneProjectProvider from "@foxglove/studio-base/providers/CoSceneProjectProvider";
import CoSceneUserProfileLocalStorageProvider from "@foxglove/studio-base/providers/CoSceneUserProfileLocalStorageProvider";
import CoSceneUserProvider from "@foxglove/studio-base/providers/CoSceneUserProvider";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

import { IdbLayoutStorage } from "./services/CoSceneIdbLayoutStorage";

const log = Logger.getLogger(__filename);

const SupportedFileTypes = [
  "text/plain",
  "image/png",
  "image/x-portable-bitmap",
  "image/x-portable-graymap",
  "image/x-portable-pixmap",
  "application/vnd.ros1.bag",
  "application/vnd.cyber.rt",
  "application/vnd.mcap",
];

const checkBagFileSupported = (file: File) => {
  return !!(file.mediaStorageUri && SupportedFileTypes.includes(file.mediaType));
};

export function CoSceneProviders(): JSX.Element[] {
  const currentUser = localStorage.getItem("current_user") ?? "{}";
  const currentUserId = JSON.parse(currentUser).userId ?? "";

  if (currentUserId == undefined || currentUserId === "") {
    throw new Error("currentUserId is empty");
  }

  const consoleApi = useMemo(
    () =>
      new ConsoleApi(
        APP_CONFIG.CS_HONEYBEE_BASE_URL,
        APP_CONFIG.VITE_APP_BFF_URL,
        localStorage.getItem("CoScene_addTopicPrefix") ??
          APP_CONFIG.DEFAULT_TOPIC_PREFIX_OPEN[window.location.hostname] ??
          "false",
        localStorage.getItem("CoScene_timeMode") === "relativeTime"
          ? "relativeTime"
          : "absoluteTime",
        {
          ...JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}"),
          currentUserId,
        } as CoSceneContext,
      ),
    [currentUserId],
  );

  consoleApi.setAuthHeader(localStorage.getItem("coScene_org_jwt") ?? "");

  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);

  useEffect(() => {
    const url = new URL(window.location.href);

    const baseInfoKey = url.searchParams.get("ds.key");

    const warehouseId = url.searchParams.get("ds.warehouseId");

    const projectId = url.searchParams.get("ds.projectId");

    // if no baseInfoKey and warehouseId, projectId, this url just for perview layout info
    if ((baseInfoKey == undefined || baseInfoKey === "") && warehouseId && projectId) {
      // 老版本url 需要转换

      const recordId = url.searchParams.get("ds.recordId");

      const revisionId = url.searchParams.get("ds.revisionId");

      const jobRunsId = url.searchParams.get("ds.jobRunsId");

      const workflowRunsId = url.searchParams.get("ds.workflowRunsId");

      const projectSlug = url.searchParams.get("ds.projectSlug");

      const warehouseSlug = url.searchParams.get("ds.warehouseSlug");

      const baseInfo: BaseInfo = {
        warehouseId,
        projectId,
        recordId: recordId ?? undefined,
        revisionId: revisionId ?? undefined,
        jobRunsId: jobRunsId ?? undefined,
        workflowRunsId: workflowRunsId ?? undefined,
        projectSlug: projectSlug ?? undefined,
        warehouseSlug: warehouseSlug ?? undefined,
      };

      if (jobRunsId) {
        const jobRunsName = `warehouses/${warehouseId}/projects/${projectId}/workflowRuns/${workflowRunsId}/jobRuns/${jobRunsId}`;
        consoleApi
          .getJobRun(jobRunsName)
          .then((jobRun) => {
            const jobRunDisplayName = jobRun.spec?.spec?.name ?? "";
            baseInfo["jobRunsDisplayName"] = jobRunDisplayName;
            baseInfo["files"] = [
              {
                jobRunsName: `warehouses/${warehouseId}/projects/${projectId}/workflowRuns/${workflowRunsId}/jobRuns/${jobRunsId}`,
              },
            ];

            consoleApi
              .setBaseInfo(baseInfo)
              .then((res) => {
                const searchParams: { [key: string]: string } = {
                  ds: "coscene-data-platform",
                  "ds.key": res,
                };

                const updatedUrl = new URL(window.location.href);
                updatedUrl.search = new URLSearchParams(searchParams).toString();

                window.location.href = updatedUrl.href;
              })
              .catch((err) => {
                log.error(err);
              });
          })
          .catch((err) => {
            log.error(err);
          });
      } else {
        const recordName = `warehouses/${warehouseId}/projects/${projectId}/records/${recordId}`;
        const revisionName = `${recordName}/revisions/${revisionId}`;

        consoleApi
          .getRecord({ recordName })
          .then((record) => {
            const fileNames: { filename: string }[] = [];
            baseInfo["recordDisplayName"] = record.getTitle() || "unknow";

            consoleApi
              .listFiles({
                revisionName,
                pageSize: 100,
                filter: "",
                currentPage: 0,
              })
              .then((res) => {
                res.files.forEach((file) => {
                  if (checkBagFileSupported(file)) {
                    fileNames.push({ filename: file.name });
                  }
                });

                baseInfo["files"] = fileNames;

                consoleApi
                  .setBaseInfo(baseInfo)
                  // eslint-disable-next-line @typescript-eslint/no-shadow
                  .then((res) => {
                    const searchParams: { [key: string]: string } = {
                      ds: "coscene-data-platform",
                      "ds.key": res,
                    };

                    const updatedUrl = new URL(window.location.href);
                    updatedUrl.search = new URLSearchParams(searchParams).toString();

                    window.location.href = updatedUrl.href;
                  })
                  .catch((err) => {
                    log.error(err);
                  });
              })
              .catch((err) => {
                log.error(err);
              });
          })
          .catch((err) => {
            log.error(err);
          });
      }

      if (recordId == undefined) {
        throw new Error("projectId or recordId is empty");
      }

      consoleApi.setProjectId(projectId);
      consoleApi.setRecordId(recordId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providers = useMemo(
    () => [
      <CoSceneBaseProvider key="CoSceneBaseProvider" />,
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
