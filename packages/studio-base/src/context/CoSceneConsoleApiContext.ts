// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

const CoSceneConsoleApiContext = createContext<ConsoleApi | undefined>(undefined);
CoSceneConsoleApiContext.displayName = "ConsoleApiContext";

function useConsoleApi(): ConsoleApi {
  const api = useContext(CoSceneConsoleApiContext);
  if (!api) {
    throw new Error("ConsoleApiContext Provider is required to useConsoleApi");
  }
  return api;
}

export { useConsoleApi };
export default CoSceneConsoleApiContext;
