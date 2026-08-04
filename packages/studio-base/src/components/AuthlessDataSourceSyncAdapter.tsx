// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";

import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { setAuthlessDataSource } from "@foxglove/studio-base/util/coscene";
import {
  SHARE_MANIFEST_DATA_SOURCE_ID,
  windowShareManifestParseResult,
} from "@foxglove/studio-base/util/shareManifest";

const selectDataSource = (state: CoreDataStore) => state.dataSource;

function isShareManifestUrlAuthless(): boolean {
  const result = windowShareManifestParseResult();
  return result.status === "valid" || result.status === "expired";
}

export function AuthlessDataSourceSyncAdapter(): ReactNull {
  const dataSource = useCoreData(selectDataSource);
  const isAuthless =
    dataSource?.id === SHARE_MANIFEST_DATA_SOURCE_ID ||
    (dataSource == undefined && isShareManifestUrlAuthless());

  useEffect(() => {
    setAuthlessDataSource({ authless: isAuthless });

    return () => {
      setAuthlessDataSource({ authless: false });
    };
  }, [isAuthless]);

  return ReactNull;
}
