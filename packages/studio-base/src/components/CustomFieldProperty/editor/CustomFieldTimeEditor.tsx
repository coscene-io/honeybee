// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Timestamp } from "@bufbuild/protobuf";
import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { TimeValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { Locale } from "date-fns";
import { zhCN, enUS, ja } from "date-fns/locale";
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
  const { i18n, t } = useTranslation("general");
  let value: Date | undefined;
  if (customFieldValue.value.case === "time") {
    value = customFieldValue.value.value.value?.toDate();
  }

  const adapterLocale: Locale = i18n.language === "zh" ? zhCN : i18n.language === "ja" ? ja : enUS;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={adapterLocale}>
      <DateTimePicker
        value={value}
        disabled={disabled}
        onChange={(newValue: Date | ReactNull) => {
          if (newValue) {
            customFieldValue.value = {
              case: "time",
              value: new TimeValue({ value: Timestamp.fromDate(newValue) }),
            };
          } else {
            customFieldValue.value = { case: undefined, value: undefined };
          }
          onChange(customFieldValue);
        }}
        localeText={{
          clearButtonLabel: t("clearButtonLabel"),
          okButtonLabel: t("okButtonLabel"),
        }}
        slotProps={{
          textField: {
            fullWidth: true,
            error,
            size: "small",
            variant: "filled",
          },
          actionBar: {
            actions: allowClear != undefined && allowClear ? ["clear", "accept"] : ["accept"],
          },
        }}
      />
    </LocalizationProvider>
  );
}
