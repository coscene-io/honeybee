// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo } from "react";
import ReactDOM from "react-dom";

import { useCrash } from "@foxglove/hooks";
import { PanelExtensionContext } from "@foxglove/studio";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import Panel from "@foxglove/studio-base/components/Panel";
import { PanelExtensionAdapter } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  useCurrentUser,
  User,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { DataCollection } from "./DataCollection";
import { Config } from "./types";

const selectUser = (store: UserStore) => store.user;

function initPanel(
  userInfo: User,
  consoleApi: ConsoleApi,
  crash: ReturnType<typeof useCrash>,
  context: PanelExtensionContext,
) {
  // eslint-disable-next-line react/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <DataCollection context={context} userInfo={userInfo} consoleApi={consoleApi} />
      </CaptureErrorBoundary>
    </StrictMode>,
    context.panelElement,
  );
  return () => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

function DataCollectionPanelAdapter(props: Props) {
  const crash = useCrash();
  const userInfo = useCurrentUser(selectUser);
  const consoleApi = useConsoleApi();

  // const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);

  const boundInitPanel = useMemo(() => {
    if (userInfo == undefined) {
      return () => {};
    }
    return initPanel.bind(undefined, userInfo, consoleApi, crash);
  }, [crash, consoleApi, userInfo]);

  if (userInfo == undefined) {
    return <div>Loading...</div>;
  }

  return (
    <PanelExtensionAdapter
      config={props.config}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
    />
  );
}

DataCollectionPanelAdapter.panelType = "DataCollectionPanel";
DataCollectionPanelAdapter.defaultConfig = {};

export default Panel(DataCollectionPanelAdapter);
