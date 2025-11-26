// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { TimeValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";
import "dayjs/locale/ja";
import { useTranslation } from "react-i18next";

export function CustomFieldTimeEditor({
  allowClear,
  error,
  onChange,
  customFieldValue,
  disabled,
}: {
  allowClear?: boolean;
  error?: boolean;
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  const { t } = useTranslation("general");
  const { property } = customFieldValue;

  let value: Dayjs | undefined;
  if (customFieldValue.value.case === "time") {
    const dateValue =
      customFieldValue.value.value.value != undefined
        ? timestampDate(customFieldValue.value.value.value)
        : undefined;
    value = dateValue ? dayjs(dateValue) : undefined;
  }

  return (
    <DateTimePicker
      value={value}
      disabled={disabled}
      timeSteps={{ minutes: 1 }}
      // label={property?.description ?? t("pleaseSelect")}
      onChange={(newValue: Dayjs | ReactNull) => {
        if (newValue) {
          customFieldValue.value = {
            case: "time",
            value: create(TimeValueSchema, { value: timestampFromDate(newValue.toDate()) }),
          };
        } else {
          customFieldValue.value = { case: undefined, value: undefined };
        }
        onChange(customFieldValue);
      }}
      localeText={{
        clearButtonLabel: t("clearButtonLabel"),
        okButtonLabel: t("okButtonLabel"),
        fieldYearPlaceholder: ({ format }) => {
          return `${property?.description ?? t("pleaseSelect")} ${format}`;
        },
      }}
      slotProps={{
        textField: {
          fullWidth: true,
          error,
          size: "small",
          variant: "filled",
          sx: {
            padding: "0px",
            "& .MuiPickersInputBase-sectionsContainer": {
              padding: "6px 8px !important",
            },
          },
        },
        openPickerButton: {
          size: "small",
        },
        actionBar: {
          actions: allowClear != undefined && allowClear ? ["clear", "accept"] : ["accept"],
        },
      }}
    />
  );
}
