// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Avatar, Badge, Box, Stack } from "@mui/material";
import dayjs from "dayjs";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

export function ConvertCustomFieldValue({
  customFieldValue,
  noWrap = false,
}: {
  customFieldValue?: CustomFieldValue;
  noWrap?: boolean;
}): ReactNode {
  let value: ReactNode;

  const consoleApi = useConsoleApi();
  const { t } = useTranslation("general");

  const [users, getUsers] = useAsyncFn(
    async (userIds?: string[]) => {
      if (userIds == undefined) {
        return;
      }

      const user = await consoleApi.batchGetUsers(userIds.map((id) => `users/${id}`));
      return user.users;
    },
    [consoleApi],
  );

  useEffect(() => {
    if (customFieldValue?.value.case === "user") {
      getUsers(customFieldValue.value.value.ids).catch((err: unknown) => {
        console.error(err);
      });
    }
  }, [customFieldValue, getUsers]);

  // 包装内容以支持noWrap
  const wrapContent = (content: ReactNode): ReactNode => {
    if (!noWrap) {
      return content;
    }

    return (
      <Box
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {content}
      </Box>
    );
  };

  switch (customFieldValue?.value.case) {
    case "text":
      value = wrapContent(customFieldValue.value.value.value);
      break;

    case "number":
      value = wrapContent(customFieldValue.value.value.value);
      break;

    case "enums":
      if (customFieldValue.property?.type.case === "enums") {
        const findEnumValue = (id: string) => {
          return customFieldValue.property?.type.case === "enums"
            ? customFieldValue.property.type.value.values[id]
            : undefined;
        };

        const enumValue = customFieldValue.value.value;
        if (!enumValue.id && enumValue.ids.length === 0) {
          value = wrapContent("");
        } else if (customFieldValue.property.type.value.multiple) {
          const findedValues = enumValue.ids
            .map((id) => findEnumValue(id))
            .filter((item) => item != undefined);
          value =
            findedValues.length > 0 ? (
              wrapContent(findedValues.join(", "))
            ) : (
              <Badge color="error">{t("unknownField")}</Badge>
            );
        } else {
          const enumContent = findEnumValue(enumValue.id) ?? (
            <Badge color="error">{t("unknownField")}</Badge>
          );
          value = typeof enumContent === "string" ? wrapContent(enumContent) : enumContent;
        }
      }
      break;

    case "time":
      if (customFieldValue.value.value.value) {
        value = wrapContent(
          dayjs(timestampDate(customFieldValue.value.value.value)).format("YYYY-MM-DD HH:mm:ss"),
        );
      }
      break;

    case "user":
      value = (
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          maxWidth="100%"
          flexWrap={noWrap ? "nowrap" : "wrap"}
          style={noWrap ? { overflow: "hidden" } : undefined}
        >
          {users.value?.map((user) => (
            <Stack direction="row" alignItems="center" gap={0.5} key={user.name} flexShrink={0}>
              <Avatar
                src={user.avatar ?? undefined}
                variant="circular"
                style={{ width: 24, height: 24 }}
              />
              <Box
                component="span"
                style={
                  noWrap
                    ? {
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }
                    : undefined
                }
              >
                {user.nickname}
              </Box>
            </Stack>
          ))}
        </Stack>
      );

      break;
  }

  return value;
}
