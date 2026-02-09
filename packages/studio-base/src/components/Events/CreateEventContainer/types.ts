// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";

import { KeyValue } from "@foxglove/studio-base/context/EventsContext";

export type CreateEventForm = {
  eventName: string;
  startTime: undefined | Date;
  duration: undefined | number;
  durationUnit: "sec" | "nsec";
  description: undefined | string;
  metadataEntries: KeyValue[];
  enabledCreateNewTask: boolean;
  // if is create new momnet, fileName is the target bag file name
  // if is edit moment, fileName is the target record name
  fileName: string;
  imageFile?: File;
  imgUrl?: string;
  files?: string[];
  record: string;
  customFieldValues?: Record<string, CustomFieldValue>;
};

export type CreateTaskForm = {
  title: string;
  description: string;
  assignee: string;
  assigner: string;
  needSyncTask: boolean;
  customFieldValues?: Record<string, CustomFieldValue>;
};
