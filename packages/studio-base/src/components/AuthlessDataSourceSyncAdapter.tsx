// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";

import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { setAuthlessDataSource } from "@foxglove/studio-base/util/coscene";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const selectIsAuthlessDataSource = (state: CoreDataStore) =>
  state.dataSource?.id === SHARE_MANIFEST_DATA_SOURCE_ID;

export function AuthlessDataSourceSyncAdapter(): ReactNull {
  const isAuthless = useCoreData(selectIsAuthlessDataSource);

  useEffect(() => {
    setAuthlessDataSource({ authless: isAuthless });

    return () => {
      setAuthlessDataSource({ authless: false });
    };
  }, [isAuthless]);

  return ReactNull;
}
