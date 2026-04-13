// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageInitShape } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Record as CoSceneRecord } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { UpdateRecordRequestSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/services/record_pb";
import { Avatar, FormLabel, Link, Typography } from "@mui/material";
import dayjs from "dayjs";
import { ReactElement, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { useGuaranteedContext } from "@foxglove/hooks";
import Logger from "@foxglove/log";
import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import ProjectDeviceSelector from "@foxglove/studio-base/components/RecordInfo/ProjectDeviceSelector";
import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoreDataContext,
  CoreDataStore,
  useCoreData,
} from "@foxglove/studio-base/context/CoreDataContext";
import {
  SubscriptionEntitlementStore,
  useSubscriptionEntitlement,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";

const selectSetRecord = (store: CoreDataStore) => store.setRecord;
const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectRecordName = (store: CoreDataStore) => store.record.value?.name;
const selectRecordDeviceName = (store: CoreDataStore) => store.record.value?.device?.name;
const selectRecordCreator = (store: CoreDataStore) => store.record.value?.creator;
const selectRecordLabels = (store: CoreDataStore) => store.record.value?.labels;
const selectRecordCustomFieldValues = (store: CoreDataStore) =>
  store.record.value?.customFieldValues;
const selectRecordCreateTime = (store: CoreDataStore) => store.record.value?.createTime;
const selectRecordUpdateTime = (store: CoreDataStore) => store.record.value?.updateTime;
const selectRecordCustomFieldSchema = (store: CoreDataStore) => store.recordCustomFieldSchema;
const selectDeviceCustomFieldSchema = (store: CoreDataStore) => store.deviceCustomFieldSchema;
const selectOrganizationSlug = (store: CoreDataStore) => store.organization.value?.slug;
const selectProjectSlug = (store: CoreDataStore) => store.project.value?.slug;
const selectPaid = (store: SubscriptionEntitlementStore) => store.paid;

const log = Logger.getLogger(__filename);

type UpdateRecordPayload = MessageInitShape<typeof UpdateRecordRequestSchema>;
type UpdateRecordFn = (payload: UpdateRecordPayload) => Promise<void>;

function getCustomFieldValueSignature(
  customFieldValue: CoSceneRecord["customFieldValues"][number],
): string {
  return (
    JSON.stringify({
      propertyId: customFieldValue.property?.id,
      value: customFieldValue.value,
    }) ?? ""
  );
}

function mergeCustomFieldValues(
  currentCustomFieldValues: CoSceneRecord["customFieldValues"],
  updatedCustomFieldValues: CoSceneRecord["customFieldValues"],
): CoSceneRecord["customFieldValues"] {
  const currentCustomFieldValuesByPropertyId = new Map(
    currentCustomFieldValues.map((customFieldValue) => [
      customFieldValue.property?.id,
      customFieldValue,
    ]),
  );

  return updatedCustomFieldValues.map((customFieldValue) => {
    const propertyId = customFieldValue.property?.id;
    if (!propertyId) {
      return customFieldValue;
    }

    const currentCustomFieldValue = currentCustomFieldValuesByPropertyId.get(propertyId);
    if (!currentCustomFieldValue) {
      return customFieldValue;
    }

    return getCustomFieldValueSignature(currentCustomFieldValue) ===
      getCustomFieldValueSignature(customFieldValue)
      ? currentCustomFieldValue
      : customFieldValue;
  });
}

function mergeUpdatedRecord(
  currentRecord: CoSceneRecord | undefined,
  updatedRecord: CoSceneRecord,
  updateMaskPaths: readonly string[],
): CoSceneRecord {
  if (!currentRecord) {
    return updatedRecord;
  }

  const mergedRecord: CoSceneRecord = {
    ...currentRecord,
    ...updatedRecord,
    createTime: currentRecord.createTime,
  };

  if (!updateMaskPaths.includes("device")) {
    mergedRecord.device = currentRecord.device;
  }

  if (!updateMaskPaths.includes("labels")) {
    mergedRecord.labels = currentRecord.labels;
  }

  if (!updateMaskPaths.includes("customFieldValues")) {
    mergedRecord.customFieldValues = currentRecord.customFieldValues;
  } else {
    mergedRecord.customFieldValues = mergeCustomFieldValues(
      currentRecord.customFieldValues,
      updatedRecord.customFieldValues,
    );
  }

  return mergedRecord;
}

function DeviceInfoSection({ updateRecord }: { updateRecord: UpdateRecordFn }): ReactElement {
  const consoleApi = useConsoleApi();
  const { t } = useTranslation("recordInfo");

  const deviceName = useCoreData(selectRecordDeviceName);
  const deviceCustomFieldSchema = useCoreData(selectDeviceCustomFieldSchema);
  const organizationSlug = useCoreData(selectOrganizationSlug);
  const projectSlug = useCoreData(selectProjectSlug);

  const [deviceInfo, getDeviceInfo] = useAsyncFn(async () => {
    if (!deviceName) {
      return;
    }

    return await consoleApi.getDevice({ deviceName });
  }, [consoleApi, deviceName]);

  const currentDeviceInfo =
    deviceInfo.value?.name != undefined && deviceInfo.value.name === deviceName
      ? deviceInfo.value
      : undefined;

  useEffect(() => {
    if (!deviceName) {
      return;
    }

    getDeviceInfo().catch((error: unknown) => {
      log.error(error);
    });
  }, [deviceName, getDeviceInfo]);

  return (
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
          data-testid={currentDeviceInfo?.serialNumber}
          href={`/${organizationSlug}/${projectSlug}/${currentDeviceInfo?.name}`}
          target="_blank"
        >
          {currentDeviceInfo?.serialNumber}
        </Link>
      </Stack>

      <CustomFieldValuesFields
        variant="secondary"
        properties={deviceCustomFieldSchema?.properties ?? []}
        customFieldValues={currentDeviceInfo?.customFieldValues ?? []}
        readonly
        ignoreProperties
      />
    </Stack>
  );
}

function RecordCreatorSection(): ReactElement {
  const consoleApi = useConsoleApi();
  const { t } = useTranslation("recordInfo");
  const creatorName = useCoreData(selectRecordCreator);

  const [creator, getCreator] = useAsyncFn(async () => {
    if (!creatorName) {
      return;
    }

    const users = await consoleApi.batchGetUsers([creatorName]);
    return users.users[0];
  }, [consoleApi, creatorName]);

  const currentCreator =
    creator.value?.name != undefined && creator.value.name === creatorName
      ? creator.value
      : undefined;

  useEffect(() => {
    if (!creatorName) {
      return;
    }

    getCreator().catch((error: unknown) => {
      log.error(error);
    });
  }, [creatorName, getCreator]);

  return (
    <Stack>
      <FormLabel>{t("creator")}</FormLabel>

      <Stack direction="row" alignItems="center" gap={1}>
        <Avatar
          src={currentCreator?.avatar ?? undefined}
          variant="circular"
          style={{ width: 24, height: 24 }}
        />
        {currentCreator?.nickname}
      </Stack>
    </Stack>
  );
}

function RecordLabelsSection({ updateRecord }: { updateRecord: UpdateRecordFn }): ReactElement {
  const consoleApi = useConsoleApi();
  const { t } = useTranslation("recordInfo");

  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const recordName = useCoreData(selectRecordName);
  const recordLabels = useCoreData(selectRecordLabels);

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
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return;
    }

    getLabels().catch((error: unknown) => {
      log.error(error);
    });
  }, [externalInitConfig?.warehouseId, externalInitConfig?.projectId, getLabels]);

  return (
    <Stack>
      <FormLabel>{t("labels")}</FormLabel>

      <Stack direction="row" alignItems="center" gap={1}>
        <RecordLabelSelector
          value={recordLabels?.map((label) => label.name) ?? []}
          options={labels.value?.labels ?? []}
          onChange={(_, newValue) => {
            if (!recordName) {
              return;
            }

            void updateRecord({
              record: { name: recordName, labels: newValue },
              updateMask: { paths: ["labels"] },
            });
          }}
        />
      </Stack>
    </Stack>
  );
}

function RecordCustomFieldsSection({
  updateRecord,
}: {
  updateRecord: UpdateRecordFn;
}): ReactElement | ReactNull {
  const consoleApi = useConsoleApi();
  const recordName = useCoreData(selectRecordName);
  const recordCustomFieldValues = useCoreData(selectRecordCustomFieldValues);
  const recordCustomFieldSchema = useCoreData(selectRecordCustomFieldSchema);

  if (!recordCustomFieldValues || !recordCustomFieldSchema?.properties) {
    return ReactNull;
  }

  return (
    <CustomFieldValuesFields
      variant="secondary"
      properties={recordCustomFieldSchema.properties}
      customFieldValues={recordCustomFieldValues}
      readonly={!consoleApi.updateRecord.permission()}
      onChange={(customFieldValues) => {
        if (!recordName) {
          return;
        }

        void updateRecord({
          record: { name: recordName, customFieldValues },
          updateMask: { paths: ["customFieldValues"] },
        });
      }}
    />
  );
}

function RecordTimestampsSection(): ReactElement | ReactNull {
  const { t } = useTranslation("recordInfo");
  const createTime = useCoreData(selectRecordCreateTime);
  const updateTime = useCoreData(selectRecordUpdateTime);

  if (!createTime && !updateTime) {
    return ReactNull;
  }

  return (
    <>
      {createTime && (
        <Stack>
          <FormLabel>{t("createTime")}</FormLabel>

          <Stack direction="row" alignItems="center" gap={1}>
            {dayjs(timestampDate(createTime)).format("YYYY-MM-DD HH:mm:ss")}
          </Stack>
        </Stack>
      )}

      {updateTime && (
        <Stack>
          <FormLabel>{t("updateTime")}</FormLabel>

          <Stack direction="row" alignItems="center" gap={1}>
            {dayjs(timestampDate(updateTime)).format("YYYY-MM-DD HH:mm:ss")}
          </Stack>
        </Stack>
      )}
    </>
  );
}

export default function RecordInfo(): ReactElement {
  const consoleApi = useConsoleApi();
  const paid = useSubscriptionEntitlement(selectPaid);
  const { t } = useTranslation("recordInfo");

  const coreDataStore = useGuaranteedContext(CoreDataContext);
  const setRecord = useCoreData(selectSetRecord);

  const updateRecord = useCallback(
    async (payload: UpdateRecordPayload) => {
      const updatedRecord = await consoleApi.updateRecord(payload);
      const currentRecord = coreDataStore.getState().record.value;

      setRecord({
        loading: false,
        value: mergeUpdatedRecord(currentRecord, updatedRecord, payload.updateMask?.paths ?? []),
      });
    },
    [consoleApi, coreDataStore, setRecord],
  );

  return (
    <Stack flex="auto" overflowX="auto" gap={2} padding={1}>
      {paid ? <DeviceInfoSection updateRecord={updateRecord} /> : undefined}

      <Stack gap={1}>
        <Typography variant="h6" gutterBottom>
          {t("recordInfo")}
        </Typography>

        <RecordCreatorSection />
        <RecordLabelsSection updateRecord={updateRecord} />
        <RecordCustomFieldsSection updateRecord={updateRecord} />
        <RecordTimestampsSection />
      </Stack>
    </Stack>
  );
}
