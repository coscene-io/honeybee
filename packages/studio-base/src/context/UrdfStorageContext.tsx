// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { IUrdfStorage } from "@foxglove/studio-base/services/IUrdfStorage";

const UrdfStorageContext = createContext<IUrdfStorage | undefined>(undefined);
UrdfStorageContext.displayName = "UrdfStorageContext";

export function useUrdfStorage(): IUrdfStorage {
  const ctx = useContext(UrdfStorageContext);
  if (ctx == undefined) {
    throw new Error("A UrdfStorage provider is required to useUrdfStorage");
  }
  return ctx;
}

export default UrdfStorageContext;
