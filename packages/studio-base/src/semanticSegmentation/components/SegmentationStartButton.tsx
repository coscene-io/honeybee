// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { Tooltip } from "@mui/material";
import { useStore } from "zustand";

import ToolbarIconButton from "@foxglove/studio-base/components/PanelToolbar/ToolbarIconButton";

import { segmentationSession } from "../runtime";
import { segmentationChrome } from "../segmentationChrome";

/**
 * Starts annotation on this canvas only. An annotation session binds to the canvas that started
 * it, so the button is hidden everywhere while a session is open.
 */
export function SegmentationStartButton({
  panelId,
}: {
  panelId: string;
}): React.JSX.Element | undefined {
  const entry = useStore(segmentationChrome, (state) =>
    state.canvases.find((canvas) => canvas.panelId === panelId),
  );
  const open = useStore(segmentationSession, (state) => state.open);
  if (!entry || open) {
    return undefined;
  }
  return (
    <Tooltip title="编辑空间标注">
      <ToolbarIconButton title={undefined} aria-label="编辑空间标注" onClick={entry.enterInline}>
        <EditOutlinedIcon />
      </ToolbarIconButton>
    </Tooltip>
  );
}
