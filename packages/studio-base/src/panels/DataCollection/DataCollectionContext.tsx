// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext, ReactNode } from "react";

import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";

import { PanelState } from "./types";

export interface DataCollectionContextType {
  panelState: PanelState;
  deviceLink: string;
  userInfo: User;
  consoleApi: ConsoleApi;
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
}: DataCollectionProviderProps): React.JSX.Element {
  return (
    <DataCollectionContext.Provider
      value={{
        panelState,
        deviceLink,
        userInfo,
        consoleApi,
      }}
    >
      {children}
    </DataCollectionContext.Provider>
  );
}

export function useDataCollectionContext(): DataCollectionContextType {
  const context = useContext(DataCollectionContext);
  if (context == undefined) {
    throw new Error("useDataCollectionContext must be used within a DataCollectionProvider");
  }
  return context;
}
