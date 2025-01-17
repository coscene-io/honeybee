// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { AppBarProps } from "@foxglove/studio-base/components/AppBar";
import { CustomWindowControlsProps } from "@foxglove/studio-base/components/AppBar/CustomWindowControls";
import { IAppConfiguration } from "@foxglove/studio-base/context/AppConfigurationContext";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { IDataSourceFactory } from "@foxglove/studio-base/context/CoScenePlayerSelectionContext";
import { ExtensionLoader } from "@foxglove/studio-base/services/ExtensionLoader";

interface ISharedRootContext {
  deepLinks: readonly string[];
  syncUserInfo?: User;
  appConfiguration?: IAppConfiguration;
  dataSources: readonly IDataSourceFactory[];
  extensionLoaders: readonly ExtensionLoader[];
  enableLaunchPreferenceScreen?: boolean;
  enableGlobalCss?: boolean;
  appBarLeftInset?: number;
  extraProviders?: readonly React.JSX.Element[];
  customWindowControlProps?: CustomWindowControlsProps;
  onAppBarDoubleClick?: () => void;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
}

const SharedRootContext = createContext<ISharedRootContext>({
  deepLinks: [],
  dataSources: [],
  extensionLoaders: [],
});
SharedRootContext.displayName = "SharedRootContext";

export function useSharedRootContext(): ISharedRootContext {
  return useContext(SharedRootContext);
}

export { SharedRootContext };
export type { ISharedRootContext };
