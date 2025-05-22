// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { UserValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
// import { InternalUserDropdown } from "@coscene-io/data-platform-web/src/components/selector/UserDropdown";

export function CustomFieldUserEditor({
  allowClear,
  onChange,
  customFieldValue,
  disabled,
}: {
  allowClear?: boolean;
  error?: boolean; // todo
  onChange: (value: CustomFieldValue) => void;
  customFieldValue: CustomFieldValue;
  disabled?: boolean;
}): React.ReactNode {
  let value = "";
  if (customFieldValue.value.case === "user") {
    value = customFieldValue.value.value.ids[0] ?? "";
  }

  return (
    <>
      CustomFieldUserEditor
      {value}
    </>
  );

  // return (
  //   <InternalUserDropdown
  //     value={value}
  //     disabled={disabled}
  //     allowClear={allowClear}
  //     onChange={(id) => {
  //       customFieldValue.value = { case: "user", value: new UserValue({ ids: [id] }) };
  //       onChange(customFieldValue);
  //     }}
  //   />
  // );
}
