// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { FormControl, FormLabel } from "@mui/material";

import { ConvertCustomFieldValue } from "../utils/convertCustomFieldValue";

export function CustomFieldValueFieldDisplay({
  customFieldValue,
  variant = "primary",
}: {
  customFieldValue: CustomFieldValue;
  variant?: "primary" | "secondary";
}): React.ReactNode {
  const value = ConvertCustomFieldValue(customFieldValue);

  return (
    <FormControl>
      <FormLabel color={variant}>{customFieldValue.property?.name}</FormLabel>
      {value ?? "-"}
    </FormControl>
  );
}
