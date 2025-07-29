// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { createContext, useContext, ReactNode, useMemo } from "react";

import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";

import { PanelState } from "./types";

export interface DataCollectionContextType {
  panelState: PanelState;
  deviceLink: string;
  userInfo: User;
  consoleApi: ConsoleApi;
  focusedTask: Task | undefined;
}

const DataCollectionContext = createContext<DataCollectionContextType | undefined>(undefined);

interface DataCollectionProviderProps extends DataCollectionContextType {
  children: ReactNode;
}

export function DataCollectionProvider({
  children,
  panelState,
  deviceLink,
  userInfo,
  consoleApi,
  focusedTask,
}: DataCollectionProviderProps): React.JSX.Element {
  const contextValue = useMemo(
    () => ({
      panelState,
      deviceLink,
      userInfo,
      consoleApi,
      focusedTask,
    }),
    [panelState, deviceLink, userInfo, consoleApi, focusedTask],
  );

  return (
    <DataCollectionContext.Provider value={contextValue}>{children}</DataCollectionContext.Provider>
  );
}

export function useDataCollectionContext(): DataCollectionContextType {
  const context = useContext(DataCollectionContext);
  if (context == undefined) {
    throw new Error("useDataCollectionContext must be used within a DataCollectionProvider");
  }
  return context;
}
