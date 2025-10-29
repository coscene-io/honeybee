// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PartialMessage } from "@bufbuild/protobuf";
import { UpdateRecordRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { FormLabel, Link, Avatar, Typography } from "@mui/material";
import dayjs from "dayjs";
import { ReactElement, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import ProjectDeviceSelector from "@foxglove/studio-base/components/RecordInfo/ProjectDeviceSelector";
import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";

const selectRecord = (store: CoreDataStore) => store.record;
const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectRefreshRecord = (store: CoreDataStore) => store.refreshRecord;
const selectRecordCustomFieldSchema = (store: CoreDataStore) => store.recordCustomFieldSchema;
const selectDeviceCustomFieldSchema = (store: CoreDataStore) => store.deviceCustomFieldSchema;
const selectOrganization = (store: CoreDataStore) => store.organization;
const selectProject = (store: CoreDataStore) => store.project;
const selectEnableList = (store: CoreDataStore) => store.getEnableList();

const log = Logger.getLogger(__filename);

export default function RecordInfo(): ReactElement {
  const consoleApi = useConsoleApi();
  const { paid } = useCoreData(selectEnableList);

  const record = useCoreData(selectRecord);
  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const recordCustomFieldSchema = useCoreData(selectRecordCustomFieldSchema);
  const deviceCustomFieldSchema = useCoreData(selectDeviceCustomFieldSchema);
  const organization = useCoreData(selectOrganization);
  const project = useCoreData(selectProject);

  const refreshRecord = useCoreData(selectRefreshRecord);

  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);
  const projectSlug = useMemo(() => project.value?.slug, [project]);

  const { t } = useTranslation("recordInfo");

  const [deviceInfo, getDeviceInfo] = useAsyncFn(async () => {
    if (paid === "DISABLE" || !record.value?.device?.name) {
      return;
    }

    return await consoleApi.getDevice({
      deviceName: record.value.device.name,
    });
  }, [consoleApi, record.value?.device?.name, paid]);

  const [creator, getCreator] = useAsyncFn(async () => {
    if (!record.value?.creator) {
      return;
    }

    const users = await consoleApi.batchGetUsers([record.value.creator]);

    return users.users[0];
  }, [consoleApi, record.value?.creator]);

  const [labels, getLabels] = useAsyncFn(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return;
    }

    return await consoleApi.listLabels({
      pageSize: 100,
      warehouseId: externalInitConfig.warehouseId,
      projectId: externalInitConfig.projectId,
    });
  }, [consoleApi, externalInitConfig?.warehouseId, externalInitConfig?.projectId]);

  useEffect(() => {
    if (paid === "ENABLE" && record.value?.device?.name) {
      getDeviceInfo().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [record.value?.device?.name, getDeviceInfo, paid]);

  useEffect(() => {
    if (record.value?.creator) {
      getCreator().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [record.value?.creator, getCreator]);

  useEffect(() => {
    if (externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      getLabels().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [externalInitConfig?.warehouseId, externalInitConfig?.projectId, getLabels]);

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
        {paid === "ENABLE" && (
          <Stack gap={1}>
            <Typography variant="h6" gutterBottom>
              {t("deviceInfo")}
            </Typography>
            <Stack>
              <ProjectDeviceSelector updateRecord={updateRecord} />
            </Stack>
            <Stack>
              <FormLabel>{t("deviceId")}</FormLabel>
              <Link
                variant="body2"
                underline="hover"
                data-testid={deviceInfo.value?.serialNumber}
                href={`/${organizationSlug}/${projectSlug}/${deviceInfo.value?.name}`}
                target="_blank"
              >
                {deviceInfo.value?.serialNumber}
              </Link>
            </Stack>

            <CustomFieldValuesFields
              variant="secondary"
              properties={deviceCustomFieldSchema?.properties ?? []}
              customFieldValues={deviceInfo.value?.customFieldValues ?? []}
              readonly
              ignoreProperties
            />
          </Stack>
        )}

        <Stack gap={1}>
          <Typography variant="h6" gutterBottom>
            {t("recordInfo")}
          </Typography>

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
                onChange={(_, newValue) => {
                  void updateRecord({
                    record: {
                      name: record.value?.name,
                      labels: newValue,
                    },
                    updateMask: { paths: ["labels"] },
                  });
                }}
              />
            </Stack>
          </Stack>

          {paid === "ENABLE" &&
            record.value?.customFieldValues &&
            recordCustomFieldSchema?.properties && (
              <CustomFieldValuesFields
                variant="secondary"
                properties={recordCustomFieldSchema.properties}
                customFieldValues={record.value.customFieldValues}
                readonly={!consoleApi.updateRecord.permission()}
                onChange={(customFieldValues) => {
                  if (!record.value) {
                    return;
                  }

                  void updateRecord({
                    record: { name: record.value.name, customFieldValues },
                    updateMask: { paths: ["customFieldValues"] },
                  });
                }}
              />
            )}

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
