// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CustomFieldValue } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";

export interface KeyValue {
  key: string;
  value: string;
}

export interface EventFormData {
  eventName: string;
  startTime: undefined | Date;
  duration: undefined | number;
  durationUnit: "sec" | "nsec";
  description: undefined | string;
  metadataEntries: KeyValue[];
  enabledCreateNewTask: boolean;
  // if is create new moment, fileName is the target bag file name
  // if is edit moment, fileName is the target record name
  fileName: string;
  imageFile?: File;
  imgUrl?: string;
  record: string;
  customFieldValues?: CustomFieldValue[];
}

export interface TaskFormData {
  title: string;
  description: string;
  assignee: string;
  assigner: string;
  needSyncTask: boolean;
  customFieldValues: CustomFieldValue[];
}

export interface ToModifyEvent {
  name?: string;
  eventName: string;
  startTime: Date | undefined;
  duration: number;
  durationUnit: "sec" | "nsec";
  description: string;
  metadataEntries: KeyValue[];
  enabledCreateNewTask: boolean;
  record: string;
  imgUrl?: string;
  customFieldValues?: CustomFieldValue[];
}
