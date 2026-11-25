// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Button } from "@mui/material";
import { useTranslation } from "react-i18next";

import Panel from "@foxglove/studio-base/components/Panel";
import PanelToolbar from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";

import Config from "./Config";

// Saved layouts can contain several NodePlayground tiles, each pointing at a different script.
function LegacyUserScriptPanel({ config }: { config: Config }): React.JSX.Element {
  const { t } = useTranslation("userScriptEditor");
  const { sidebarActions } = useWorkspaceActions();
  const autoFormatOnSave = useWorkspaceStore(
    (store) => store.sidebars.right.userScriptEditor?.autoFormatOnSave,
  );

  return (
    <Stack fullHeight>
      <PanelToolbar />
      <Stack flex="auto" alignItems="center" justifyContent="center">
        <Button
          onClick={() => {
            sidebarActions.right.updateUserScriptEditor({
              selectedNodeId: config.selectedNodeId,
              autoFormatOnSave: autoFormatOnSave ?? config.autoFormatOnSave ?? true,
            });
            sidebarActions.right.selectItem("user-scripts");
          }}
        >
          {t("openInSidebar")}
        </Button>
      </Stack>
    </Stack>
  );
}

export default Panel(
  Object.assign(LegacyUserScriptPanel, {
    panelType: "NodePlayground",
    defaultConfig: {},
    configInitialization: "none" as const,
  }),
);
