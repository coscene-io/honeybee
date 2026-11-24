// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore, type StoreApi } from "zustand";

import type { CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";

export const CLOUD_RECORD = "warehouses/w/projects/p/records/r";

/** A Core Data store holding only the open record and data source, as the rollout gate reads them. */
export function createCoreDataSourceStore(
  source: { recordName?: string; dataSourceId?: string } = {
    recordName: CLOUD_RECORD,
    dataSourceId: "coscene-data-platform",
  },
): StoreApi<CoreDataStore> {
  return createStore(() => ({
    record: {
      loading: false,
      value: source.recordName == undefined ? undefined : { name: source.recordName },
    },
    dataSource:
      source.dataSourceId == undefined
        ? undefined
        : { id: source.dataSourceId, type: "connection" as const },
  })) as unknown as StoreApi<CoreDataStore>;
}
