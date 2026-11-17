// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo } from "react";

import { useCrash } from "@foxglove/hooks";
import { PanelExtensionContext } from "@foxglove/studio";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import Panel from "@foxglove/studio-base/components/Panel";
import { PanelExtensionAdapter } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { mountPanel } from "@foxglove/studio-base/components/PanelExtensionAdapter/mountPanel";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { CallService } from "./CallService";
import { Config } from "./types";

function initPanel(crash: ReturnType<typeof useCrash>, context: PanelExtensionContext) {
  return mountPanel(
    context.panelElement,
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <CallService context={context} />
      </CaptureErrorBoundary>
    </StrictMode>,
  );
}

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

function CallServicePanelAdapter(props: Props) {
  const crash = useCrash();
  const boundInitPanel = useMemo(() => initPanel.bind(undefined, crash), [crash]);

  return (
    <PanelExtensionAdapter
      config={props.config}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
      highestSupportedConfigVersion={1}
    />
  );
}

CallServicePanelAdapter.panelType = "CallService";
CallServicePanelAdapter.defaultConfig = {};

export default Panel(CallServicePanelAdapter);
