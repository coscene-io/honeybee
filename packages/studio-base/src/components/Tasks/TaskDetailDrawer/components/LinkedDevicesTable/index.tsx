// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListProjectDevicesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/device_pb";

import { CosQuery } from "@foxglove/studio-base/util/coscene";

export default function LinkedDevicesTable({
  linkedDevices,
  pageSize,
  currentPage,
  setPageSize,
  setCurrentPage,
  setFilter,
}: {
  linkedDevices: ListProjectDevicesResponse;
  pageSize: number;
  currentPage: number;
  setPageSize: (pageSize: number) => void;
  setCurrentPage: (currentPage: number) => void;
  setFilter: (filter: CosQuery) => void;
}): React.ReactElement {
  return <div>LinkedDevicesTable</div>;
}
