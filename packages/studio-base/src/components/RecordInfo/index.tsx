// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PartialMessage } from "@bufbuild/protobuf";
import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { UpdateRecordRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { FormLabel, Link, Avatar, SelectChangeEvent } from "@mui/material";
import dayjs from "dayjs";
import { ReactElement, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import ProjectDeviceSelector from "@foxglove/studio-base/components/RecordInfo/ProjectDeviceSelector";
import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const selectRecord = (store: CoSceneBaseStore) => store.record;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectProject = (store: CoSceneBaseStore) => store.project;
const selectRefreshRecord = (store: CoSceneBaseStore) => store.refreshRecord;

const log = Logger.getLogger(__filename);

export default function RecordInfo(): ReactElement {
  const consoleApi = useConsoleApi();
  const record = useBaseInfo(selectRecord);
  const project = useBaseInfo(selectProject);
  const baseInfo = useBaseInfo(selectBaseInfo);

  const refreshRecord = useBaseInfo(selectRefreshRecord);

  const { t } = useTranslation("recordInfo");

  const [deviceInfo, getDeviceInfo] = useAsyncFn(async () => {
    if (!record.value?.device?.name) {
      return;
    }

    return await consoleApi.getDevice({
      deviceName: record.value.device.name,
    });
  }, [consoleApi, record.value?.device?.name]);

  const [creator, getCreator] = useAsyncFn(async () => {
    if (!record.value?.creator) {
      return;
    }

    return await consoleApi.getUser(record.value.creator);
  }, [consoleApi, record.value?.creator]);

  const [labels, getLabels] = useAsyncFn(async () => {
    if (!baseInfo.value?.warehouseId || !baseInfo.value.projectId) {
      return;
    }

    return await consoleApi.listLabels({
      pageSize: 100,
      warehouseId: baseInfo.value.warehouseId,
      projectId: baseInfo.value.projectId,
    });
  }, [consoleApi, baseInfo.value?.warehouseId, baseInfo.value?.projectId]);

  useEffect(() => {
    if (record.value?.device?.name) {
      getDeviceInfo().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [record.value?.device?.name, getDeviceInfo]);

  useEffect(() => {
    if (record.value?.creator) {
      getCreator().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [record.value?.creator, getCreator]);

  useEffect(() => {
    if (baseInfo.value?.warehouseId && baseInfo.value.projectId) {
      getLabels().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [baseInfo.value?.warehouseId, baseInfo.value?.projectId, getLabels]);

  const updateRecord = useCallback(
    async (payload: PartialMessage<UpdateRecordRequest>) => {
      await consoleApi.updateRecord(payload);

      refreshRecord();
    },
    [consoleApi, refreshRecord],
  );

  return (
    <>
      <Stack flex="auto" overflowX="auto" gap={2} padding={1}>
        <Stack gap={1}>
          <FormLabel>设备信息</FormLabel>
          <Stack>
            <ProjectDeviceSelector updateRecord={updateRecord} />
          </Stack>

          <Stack>
            <FormLabel>Device ID</FormLabel>
            <Link
              variant="body2"
              underline="hover"
              data-testid={deviceInfo.value?.serialNumber}
              href={`/${baseInfo.value?.organizationSlug}/${baseInfo.value?.projectSlug}/${deviceInfo.value?.name}`}
              target="_blank"
            >
              {deviceInfo.value?.serialNumber}
            </Link>
          </Stack>
        </Stack>

        <Stack gap={1}>
          <FormLabel>{t("deviceInfo")}</FormLabel>
          <Stack>
            <FormLabel>{t("project")}</FormLabel>
            <Link
              variant="body2"
              underline="hover"
              data-testid={project.value?.displayName}
              href={`/${baseInfo.value?.organizationSlug}/${baseInfo.value?.projectSlug}`}
              target="_blank"
            >
              {project.value?.displayName}
            </Link>
          </Stack>

          <Stack>
            <FormLabel>{t("creator")}</FormLabel>

            <Stack direction="row" alignItems="center" gap={1}>
              <Avatar
                src={creator.value?.avatar ?? undefined}
                variant="circular"
                style={{ width: 24, height: 24 }}
              />
              {creator.value?.nickname}
            </Stack>
          </Stack>

          <Stack>
            <FormLabel>{t("labels")}</FormLabel>

            <Stack direction="row" alignItems="center" gap={1}>
              <RecordLabelSelector
                value={record.value?.labels.map((label) => label.name) ?? []}
                options={labels.value?.labels ?? []}
                onChange={(event: SelectChangeEvent<string[]>) => {
                  void updateRecord({
                    record: {
                      name: record.value?.name,
                      labels: (event.target.value as string[])
                        .map(
                          (labelName) =>
                            labels.value?.labels.find((label) => label.name === labelName),
                        )
                        .filter((label): label is Label => label != undefined),
                    },
                    updateMask: { paths: ["labels"] },
                  });
                }}
              />
            </Stack>
          </Stack>

          {record.value?.createTime && (
            <Stack>
              <FormLabel>{t("createTime")}</FormLabel>

              <Stack direction="row" alignItems="center" gap={1}>
                {dayjs(record.value.createTime.toDate()).format("YYYY-MM-DD HH:mm:ss")}
              </Stack>
            </Stack>
          )}

          {record.value?.updateTime && (
            <Stack>
              <FormLabel>{t("updateTime")}</FormLabel>

              <Stack direction="row" alignItems="center" gap={1}>
                {dayjs(record.value.updateTime.toDate()).format("YYYY-MM-DD HH:mm:ss")}
              </Stack>
            </Stack>
          )}
        </Stack>
      </Stack>
    </>
  );
}
