// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { UserValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { useTranslation } from "react-i18next";

import { UserSelect } from "@foxglove/studio-base/components/UserSelect";

export function CustomFieldUserEditor({
  allowClear,
  onChange,
  customFieldValue,
  disabled,
  error,
}: {
  allowClear?: boolean;
  error?: boolean; // todo
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  const { t } = useTranslation("general");

  let value = "";
  if (customFieldValue.value.case === "user") {
    value = customFieldValue.value.value.ids[0] ?? "";
  }

  const multiSelect =
    customFieldValue.property?.type.case === "user"
      ? customFieldValue.property.type.value.multiple
      : false;

  if (multiSelect) {
    let value: string[] = [];
    if (customFieldValue.value.case === "user") {
      value = customFieldValue.value.value.ids.map((id) => {
        // if id is reference field will be like {{task.assignee}}
        if (id && !id.startsWith("users/") && !id.startsWith("{{")) {
          return `users/${id}`;
        }
        return id;
      });
    }

    return (
      <UserSelect
        value={value}
        allowClear={allowClear}
        disabled={disabled}
        error={error}
        placeholder={customFieldValue.property?.description ?? t("pleaseSelect")}
        multiple
        onChange={(users) => {
          if (Array.isArray(users)) {
            const userIds = users.map((u) => {
              const id = u.name.split("/").pop() ?? "";
              return id;
            });
            customFieldValue.value = {
              case: "user",
              value: create(UserValueSchema, { ids: userIds }),
            };
          } else {
            customFieldValue.value = { case: undefined };
          }
          onChange(customFieldValue);
        }}
      />
    );
  }

  return (
    <UserSelect
      value={`users/${value}`}
      allowClear={allowClear}
      disabled={disabled}
      error={error}
      placeholder={customFieldValue.property?.description ?? t("pleaseSelect")}
      onChange={(user) => {
        if (!Array.isArray(user)) {
          customFieldValue.value = {
            case: "user",
            value: create(UserValueSchema, { ids: [user.name.split("/").pop() ?? ""] }),
          };
          onChange(customFieldValue);
        }
      }}
    />
  );
}
