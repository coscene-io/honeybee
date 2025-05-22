// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PartialMessage } from "@bufbuild/protobuf";
import { UpdateRecordRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { MenuItem, Select, SelectChangeEvent, Typography } from "@mui/material";
import { ReactElement, useCallback, useEffect, useMemo } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

export const MAX_DEVICE_LIST_LENGTH = 99999;
const log = Logger.getLogger(__filename);

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectRecord = (store: CoSceneBaseStore) => store.record;

export default function ProjectDeviceSelector({
  updateRecord,
}: {
  updateRecord: (payload: PartialMessage<UpdateRecordRequest>) => Promise<void>;
}): ReactElement {
  const consoleApi = useConsoleApi();
  const baseInfo = useBaseInfo(selectBaseInfo);
  const record = useBaseInfo(selectRecord);

  const disabled =
    !consoleApi.updateRecord.permission() || !consoleApi.listProjectDevices.permission();

  const authorizedDeviceFilter = useMemo(() => {
    const filter = CosQuery.Companion.empty();
    filter.setField(QueryFields.AUTHORIZE_STATE, [BinaryOperator.EQ], ["APPROVED"]);
    return filter;
  }, []);

  const [projectDevices, getProjectDevices] = useAsyncFn(async () => {
    if (!baseInfo.value?.warehouseId || !baseInfo.value.projectId) {
      return [];
    }

    const devices = await consoleApi.listProjectDevices({
      pageSize: MAX_DEVICE_LIST_LENGTH,
      filter: authorizedDeviceFilter,
      currentPage: 0,
      warehouseId: baseInfo.value.warehouseId,
      projectId: baseInfo.value.projectId,
    });
    return devices.projectDevices;
  }, [consoleApi, baseInfo.value?.warehouseId, baseInfo.value?.projectId, authorizedDeviceFilter]);

  useEffect(() => {
    getProjectDevices().catch((error: unknown) => {
      log.error(error);
    });
  }, [getProjectDevices]);

  const selectDevice = useCallback(
    async (event: SelectChangeEvent) => {
      const deviceName = event.target.value;

      void updateRecord({
        record: {
          name: record.value?.name,
          device: deviceName ? { name: deviceName } : undefined,
        },
        updateMask: { paths: ["device"] },
      });
    },
    [updateRecord, record.value?.name],
  );

  return (
    <Stack fullWidth>
      <Select
        size="small"
        value={record.value?.device?.name ?? ""}
        disabled={disabled}
        fullWidth
        variant="filled"
        onChange={selectDevice}
        renderValue={(value) => {
          const device = projectDevices.value?.find((d) => d.name === value);
          return <Stack>{device?.displayName}</Stack>;
        }}
      >
        {projectDevices.value?.map((device) => (
          <MenuItem key={device.name} value={device.name}>
            <Stack>
              {device.displayName}
              <Typography variant="body2" color="text.secondary">
                {device.serialNumber}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}
