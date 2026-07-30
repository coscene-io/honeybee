// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";

import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { isAuthlessDataSourceId } from "@foxglove/studio-base/util/authlessDataSources";
import { setAuthlessDataSource } from "@foxglove/studio-base/util/coscene";
import { windowShareManifestParseResult } from "@foxglove/studio-base/util/shareManifest";

const selectDataSource = (state: CoreDataStore) => state.dataSource;

function isShareManifestUrlAuthless(): boolean {
  const result = windowShareManifestParseResult();
  return result.status === "valid" || result.status === "expired";
}

export function AuthlessDataSourceSyncAdapter(): ReactNull {
  const dataSource = useCoreData(selectDataSource);
  const isAuthless =
    isAuthlessDataSourceId(dataSource?.id) ||
    (dataSource == undefined && isShareManifestUrlAuthless());

  useEffect(() => {
    setAuthlessDataSource({ authless: isAuthless });

    return () => {
      setAuthlessDataSource({ authless: false });
    };
  }, [isAuthless]);

  return ReactNull;
}
