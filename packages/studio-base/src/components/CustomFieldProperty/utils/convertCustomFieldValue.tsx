// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Avatar, Stack } from "@mui/material";
import dayjs from "dayjs";
import { useEffect, type ReactNode } from "react";
import { useAsyncFn } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

export function ConvertCustomFieldValue(customFieldValue?: CustomFieldValue): ReactNode {
  let value: ReactNode;

  const consoleApi = useConsoleApi();

  const [user, getUser] = useAsyncFn(
    async (userId?: string) => {
      if (userId == undefined) {
        return;
      }

      const user = await consoleApi.batchGetUsers([`users/${userId}`]);
      return user.users[0];
    },
    [consoleApi],
  );

  useEffect(() => {
    if (customFieldValue?.value.case === "user") {
      getUser(customFieldValue.value.value.ids[0]).catch((err: unknown) => {
        console.error(err);
      });
    }
  }, [customFieldValue, getUser]);

  switch (customFieldValue?.value.case) {
    case "text":
      value = customFieldValue.value.value.value;
      break;

    case "number":
      value = customFieldValue.value.value.value;
      break;

    case "enums":
      if (customFieldValue.property?.type.case === "enums") {
        value = customFieldValue.property.type.value.values[customFieldValue.value.value.id];
      }
      break;

    case "time":
      if (customFieldValue.value.value.value) {
        value = dayjs(customFieldValue.value.value.value.toDate()).format("YYYY-MM-DD HH:mm:ss");
      }
      break;

    case "user":
      value = (
        <Stack direction="row" alignItems="center" gap={1}>
          <Avatar
            src={user.value?.avatar ?? undefined}
            variant="circular"
            style={{ width: 24, height: 24 }}
          />
          {user.value?.nickname}
        </Stack>
      );

      break;
  }

  return value;
}
