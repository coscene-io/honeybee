// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  CustomFieldValue,
  Property,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

// 检查必填自定义字段是否都已填写的辅助函数
export const checkRequiredCustomFieldsFilled = (
  properties: Property[] | undefined,
  customFieldValues: CustomFieldValue[] | undefined,
): boolean => {
  if (!properties) {
    return true; // 如果没有自定义字段配置，则认为已填写完整
  }

  // 获取所有必填字段
  const requiredProperties = properties.filter((property) => property.required);

  if (requiredProperties.length === 0) {
    return true; // 如果没有必填字段，则认为已填写完整
  }

  // 检查每个必填字段是否都有值
  return requiredProperties.every((property) => {
    const fieldValue = customFieldValues?.find((value) => value.property?.id === property.id);

    if (!fieldValue?.value.value) {
      return false; // 字段没有值
    }

    return true;
  });
};

// 触发Tab键切换到下一个输入框
export const invokeTabKey = (): void => {
  // get the active element when Enter was pressed and
  // if it is an input, focus the next input
  // NOTE: You cannot really trigger the browser event -
  //       even if you do, the browser won't execute the action
  //       (such as focusing the next input) so you have to define the action
  let currInput = document.activeElement;
  if (currInput?.tagName.toLowerCase() === "input") {
    const inputs = document.getElementsByTagName("input");
    currInput = document.activeElement;
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i] === currInput) {
        const next = inputs[i + 1];
        if (next?.focus) {
          next.focus();
        }
        break;
      }
    }
  }
};
