// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { ExtensionContext, PanelExtensionContext } from "@foxglove/studio";
import * as React from "react";
import { createRoot } from "react-dom/client";

import FaultRecordPanel from "./FaultRecordPanel";
import { defaultConfig } from "./settings";
import type { FaultRecordConfig } from "./settings";

export function activate(context: ExtensionContext) {
  context.registerPanel({
    name: "Fault Record",

    initPanel(panelCtx: PanelExtensionContext) {
      const root = createRoot(panelCtx.panelElement);
      const render = () => { 
        root.render(React.createElement(FaultRecordPanel, {
          context: panelCtx
        })); 
      };

      render();

      return () => { root.unmount(); };
    },
  });
}

export function deactivate() {}